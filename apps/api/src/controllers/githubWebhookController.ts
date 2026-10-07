import { ZodError } from "zod";
import type { Request, Response } from "express";

import { getRuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { getCorrelationId } from "../security/auth.js";
import {
  parseVerifiedGitHubWebhook,
  verifyGitHubWebhookSignature,
} from "../integrations/githubApp.js";
import { PrismaGitHubDeliveryStore } from "../integrations/githubDeliveryStore.js";
import { applyGitHubInstallationEvent } from "../integrations/githubInstallationService.js";
import { enqueueRepositoryScan } from "../services/scanQueue.js";
import { processGitHubWebhookDelivery } from "../integrations/githubWebhookLifecycle.js";

function sendWebhookError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({
    error: { code, message, correlationId: getCorrelationId(response) },
  });
}

export async function githubWebhookController(request: Request, response: Response): Promise<void> {
  const config = getRuntimeConfig();
  if (!config.githubWebhookEnabled || config.GITHUB_WEBHOOK_SECRET == null) {
    sendWebhookError(response, 404, "NOT_FOUND", "GitHub webhook ingestion is not enabled.");
    return;
  }

  if (!Buffer.isBuffer(request.body)) {
    sendWebhookError(
      response,
      400,
      "RAW_BODY_REQUIRED",
      "The GitHub webhook raw body is required.",
    );
    return;
  }

  const eventHeader = request.header("x-github-event");
  if (
    eventHeader != null &&
    !["installation", "installation_repositories", "push", "pull_request"].includes(eventHeader)
  ) {
    if (
      !verifyGitHubWebhookSignature(
        request.body,
        request.header("x-hub-signature-256"),
        config.GITHUB_WEBHOOK_SECRET,
      )
    ) {
      sendWebhookError(response, 401, "INVALID_WEBHOOK", "GitHub webhook validation failed.");
      return;
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.header("x-github-delivery") ?? "")) {
      sendWebhookError(response, 400, "INVALID_WEBHOOK", "GitHub webhook validation failed.");
      return;
    }
    response.status(202).json({ status: "ignored" });
    return;
  }
  let webhook;
  try {
    const signature = request.header("x-hub-signature-256");
    const delivery = request.header("x-github-delivery");
    const event = request.header("x-github-event");
    const headers = {
      ...(signature == null ? {} : { signature }),
      ...(delivery == null ? {} : { delivery }),
      ...(event == null ? {} : { event }),
    };
    webhook = parseVerifiedGitHubWebhook(request.body, headers, config.GITHUB_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid GitHub webhook.";
    const status = message.includes("signature") ? 401 : 400;
    sendWebhookError(response, status, "INVALID_WEBHOOK", "GitHub webhook validation failed.");
    return;
  }

  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId: webhook.installationId },
    select: { organizationId: true },
  });
  if (installation == null) {
    sendWebhookError(
      response,
      403,
      "UNKNOWN_INSTALLATION",
      "GitHub installation is not registered.",
    );
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (webhook.eventName === "installation" || webhook.eventName === "installation_repositories")
        await tx.$queryRaw`SELECT "id" FROM "GitHubInstallation" WHERE "installationId" = ${webhook.installationId} AND "organizationId" = ${installation.organizationId} FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT "id" FROM "GitHubInstallation" WHERE "installationId" = ${webhook.installationId} AND "organizationId" = ${installation.organizationId} FOR SHARE`;
      const store = new PrismaGitHubDeliveryStore(tx);
      const claimed = await store.claim({
        organizationId: installation.organizationId,
        webhook,
        rawPayload: request.body as Buffer,
        correlationId: getCorrelationId(response),
      });
      if (!claimed) return { status: "DUPLICATE", scanQueued: false };
      if (
        webhook.eventName === "installation" ||
        webhook.eventName === "installation_repositories"
      ) {
        await applyGitHubInstallationEvent(
          tx,
          installation.organizationId,
          webhook,
          getCorrelationId(response),
        );
        await store.markProcessed(installation.organizationId, webhook.deliveryId);
        return { status: "PROCESSED", scanQueued: false };
      }
      const lifecycle = await processGitHubWebhookDelivery(
        installation.organizationId,
        webhook,
        getCorrelationId(response),
        {
          client: tx,
          updateRepositoryMetadata: async (id, fullName) => {
            await tx.repository.updateMany({
              where: {
                id,
                organizationId: installation.organizationId,
                githubInstallation: { installationId: webhook.installationId },
              },
              data: { fullName },
            });
          },
          deliveryStore: store,
          scanLifecycleEnabled: config.githubScanLifecycleEnabled,
          ...(config.GITHUB_SCAN_POLICY_BUNDLE_VERSION == null
            ? {}
            : { policyBundleVersion: config.GITHUB_SCAN_POLICY_BUNDLE_VERSION }),
          enqueueScan: (input, key, org, requester, correlation, trigger) =>
            enqueueRepositoryScan(input, key, org, requester, correlation, trigger, tx),
        },
      );
      if (lifecycle.status === "FAILED") throw new Error("GITHUB_ENQUEUE_FAILED");
      await tx.auditEvent.create({
        data: {
          organizationId: installation.organizationId,
          actor: "github:webhook",
          action: "GITHUB_DELIVERY_ACCEPTED",
          entityType: "GitHubWebhookDelivery",
          entityId: webhook.deliveryId,
          correlationId: getCorrelationId(response),
          ...(lifecycle.status === "QUEUED" ? { scanId: lifecycle.scanId } : {}),
          metadata: {
            installationId: webhook.installationId,
            deliveryId: webhook.deliveryId,
            event: webhook.eventName,
            state: lifecycle.status,
          },
        },
      });
      return lifecycle;
    });
    response.status(result.status === "DUPLICATE" ? 200 : 202).json({
      ...result,
      status: result.status.toLowerCase(),
      deliveryId: webhook.deliveryId,
      correlationId: getCorrelationId(response),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      sendWebhookError(response, 400, "INVALID_WEBHOOK", "GitHub webhook validation failed.");
      return;
    }
    // The transaction includes delivery acceptance and enqueue. GitHub may redeliver safely.
    sendWebhookError(
      response,
      503,
      "WEBHOOK_UNAVAILABLE",
      "Webhook processing is temporarily unavailable.",
    );
  }
}
