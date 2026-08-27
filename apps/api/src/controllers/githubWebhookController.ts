import type { Request, Response } from "express";

import { getRuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { getCorrelationId } from "../security/auth.js";
import { parseVerifiedGitHubWebhook } from "../integrations/githubApp.js";
import { PrismaGitHubDeliveryStore } from "../integrations/githubDeliveryStore.js";

const SUPPORTED_EVENTS = new Set([
  "installation",
  "installation_repositories",
  "push",
  "pull_request",
]);

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

  if (!SUPPORTED_EVENTS.has(webhook.eventName)) {
    await store.markProcessed(installation.organizationId, webhook.deliveryId);
    response.status(202).json({
      status: "recorded_unsupported_event",
      deliveryId: webhook.deliveryId,
      correlationId: getCorrelationId(response),
    });
    return;
  }

  // Repository resolution and scan enqueue remain explicitly separate until a configured
  // provider adapter is available; this endpoint records the verified delivery only.
  await store.markProcessed(installation.organizationId, webhook.deliveryId);
  response.status(202).json({
    status: "recorded",
    deliveryId: webhook.deliveryId,
    event: webhook.eventName,
    scanQueued: false,
    correlationId: getCorrelationId(response),
  });
}
