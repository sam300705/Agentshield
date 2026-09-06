import type { Request, Response } from "express";

import { getRuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { getCorrelationId } from "../security/auth.js";
import { parseVerifiedGitHubWebhook } from "../integrations/githubApp.js";
import { PrismaGitHubDeliveryStore } from "../integrations/githubDeliveryStore.js";
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

  const store = new PrismaGitHubDeliveryStore(prisma);
  const claimed = await store.claim({
    organizationId: installation.organizationId,
    webhook,
    rawPayload: request.body,
    correlationId: getCorrelationId(response),
  });
  if (!claimed) {
    response.status(200).json({
      status: "duplicate",
      deliveryId: webhook.deliveryId,
      correlationId: getCorrelationId(response),
    });
    return;
  }

  const lifecycleConfig = getRuntimeConfig();
  const lifecycle = await processGitHubWebhookDelivery(
    installation.organizationId,
    webhook,
    getCorrelationId(response),
    {
      client: prisma,
      deliveryStore: store,
      scanLifecycleEnabled: lifecycleConfig.githubScanLifecycleEnabled,
      ...(lifecycleConfig.GITHUB_SCAN_POLICY_BUNDLE_VERSION == null
        ? {}
        : { policyBundleVersion: lifecycleConfig.GITHUB_SCAN_POLICY_BUNDLE_VERSION }),
    },
  );
  response.status(lifecycle.status === "FAILED" ? 503 : 202).json({
    status: lifecycle.status.toLowerCase(),
    deliveryId: webhook.deliveryId,
    event: webhook.eventName,
    scanQueued: lifecycle.scanQueued,
    ...(lifecycle.status === "QUEUED"
      ? { scanId: lifecycle.scanId, jobId: lifecycle.jobId }
      : lifecycle.status === "IGNORED"
        ? { reason: lifecycle.reason }
        : lifecycle.status === "FAILED"
          ? { reason: lifecycle.reason }
          : {}),
    correlationId: getCorrelationId(response),
  });
}
