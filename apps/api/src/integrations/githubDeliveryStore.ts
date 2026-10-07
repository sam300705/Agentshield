import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { sanitizeText } from "@agentshield/schemas";

import type { VerifiedGitHubWebhook } from "./githubApp.js";

export interface GitHubDeliveryClaim {
  organizationId: string;
  webhook: VerifiedGitHubWebhook;
  rawPayload: Buffer;
  correlationId: string;
}

export interface GitHubDeliveryStore {
  claim(input: GitHubDeliveryClaim): Promise<boolean>;
  markResolved(organizationId: string, deliveryId: string): Promise<void>;
  markQueued(organizationId: string, deliveryId: string, scanId: string): Promise<void>;
  markIgnored(organizationId: string, deliveryId: string, reason: string): Promise<void>;
  markProcessed(organizationId: string, deliveryId: string): Promise<void>;
  markFailed(organizationId: string, deliveryId: string, reason: string): Promise<void>;
}

export class PrismaGitHubDeliveryStore implements GitHubDeliveryStore {
  constructor(private readonly client: PrismaClient | Prisma.TransactionClient) {}

  async claim(input: GitHubDeliveryClaim): Promise<boolean> {
    try {
      const result = await this.client.gitHubWebhookDelivery.createMany({
        skipDuplicates: true,
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          installationId: input.webhook.installationId,
          deliveryId: input.webhook.deliveryId,
          eventName: input.webhook.eventName,
          action: input.webhook.action,
          repositoryFullName:
            input.webhook.repositoryFullName == null
              ? null
              : sanitizeText(input.webhook.repositoryFullName),
          ...deliveryContext(input.webhook),
          correlationId: input.correlationId,
          payloadHash: createHash("sha256").update(input.rawPayload).digest("hex"),
          status: "RECEIVED",
        },
      });
      return result.count === 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  async markResolved(organizationId: string, deliveryId: string): Promise<void> {
    await this.client.gitHubWebhookDelivery.updateMany({
      where: { organizationId, deliveryId, status: { in: ["RECEIVED", "RESOLVED"] } },
      data: { status: "RESOLVED", failureReason: null },
    });
  }

  async markQueued(organizationId: string, deliveryId: string, scanId: string): Promise<void> {
    await this.client.gitHubWebhookDelivery.updateMany({
      where: { organizationId, deliveryId, status: { in: ["RECEIVED", "RESOLVED", "QUEUED"] } },
      data: { status: "QUEUED", scanId, failureReason: null },
    });
  }

  async markIgnored(organizationId: string, deliveryId: string, reason: string): Promise<void> {
    await this.client.gitHubWebhookDelivery.updateMany({
      where: { organizationId, deliveryId },
      data: {
        status: "IGNORED",
        failureReason: sanitizeText(reason).slice(0, 500),
        processedAt: new Date(),
        nextAttemptAt: null,
      },
    });
  }

  async markProcessed(organizationId: string, deliveryId: string): Promise<void> {
    await this.client.gitHubWebhookDelivery.updateMany({
      where: { organizationId, deliveryId },
      data: { status: "PROCESSED", processedAt: new Date(), nextAttemptAt: null },
    });
  }

  async markFailed(organizationId: string, deliveryId: string, reason: string): Promise<void> {
    await this.client.gitHubWebhookDelivery.updateMany({
      where: { organizationId, deliveryId },
      data: {
        status: "FAILED",
        failureReason: sanitizeText(reason).slice(0, 500),
        attempts: { increment: 1 },
      },
    });
  }
}

function deliveryContext(webhook: VerifiedGitHubWebhook) {
  const object = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value != null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const repository = object(webhook.payload.repository),
    pr = object(webhook.payload.pull_request),
    head = object(pr.head);
  const sha = webhook.eventName === "push" ? webhook.payload.after : head.sha;
  const ref = webhook.eventName === "push" ? webhook.payload.ref : head.ref;
  return {
    ...(typeof repository.id === "number" &&
    Number.isSafeInteger(repository.id) &&
    repository.id > 0
      ? { repositoryExternalId: String(repository.id) }
      : {}),
    ...(typeof pr.number === "number" &&
    Number.isSafeInteger(pr.number) &&
    pr.number > 0 &&
    pr.number <= 2147483647
      ? { pullRequestNumber: pr.number }
      : {}),
    ...(typeof sha === "string" && /^[a-f0-9]{40}$/i.test(sha) ? { commitSha: sha } : {}),
    ...(typeof ref === "string" && ref.length <= 256 ? { ref: sanitizeText(ref) } : {}),
  };
}
