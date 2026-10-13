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
  private readonly claims = new Map<string, number>();

  constructor(private readonly client: PrismaClient) {}

  private owned(organizationId: string, deliveryId: string) {
    const attempts = this.claims.get(`${organizationId}:${deliveryId}`);
    if (attempts == null) throw new Error("Webhook delivery is not claimed by this processor.");
    return { organizationId, deliveryId, attempts };
  }

  async claim(input: GitHubDeliveryClaim): Promise<boolean> {
    const payloadHash = createHash("sha256").update(input.rawPayload).digest("hex");
    const key = `${input.organizationId}:${input.webhook.deliveryId}`;
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 5 * 60_000);
    try {
      await this.client.gitHubWebhookDelivery.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          installationId: input.webhook.installationId,
          deliveryId: input.webhook.deliveryId,
          eventName: input.webhook.eventName,
          action: input.webhook.action,
          repositoryFullName: input.webhook.repositoryFullName,
          correlationId: input.correlationId,
          payloadHash,
          attempts: 1,
          nextAttemptAt: leaseUntil,
          status: "RECEIVED",
        },
      });
      this.claims.set(key, 1);
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.client.gitHubWebhookDelivery.findUnique({
          where: {
            organizationId_deliveryId: {
              organizationId: input.organizationId,
              deliveryId: input.webhook.deliveryId,
            },
          },
        });
        if (existing == null || existing.payloadHash !== payloadHash) return false;
        const recovered = await this.client.gitHubWebhookDelivery.updateMany({
          where: {
            id: existing.id,
            attempts: existing.attempts,
            payloadHash,
            OR: [
              { status: "FAILED" },
              { status: { in: ["RECEIVED", "RESOLVED"] }, nextAttemptAt: { lte: now } },
              {
                status: { in: ["RECEIVED", "RESOLVED"] },
                nextAttemptAt: null,
                receivedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
              },
            ],
          },
          data: {
            status: "RECEIVED",
            attempts: { increment: 1 },
            nextAttemptAt: leaseUntil,
            failureReason: null,
          },
        });
        if (recovered.count !== 1) return false;
        this.claims.set(key, existing.attempts + 1);
        return true;
      }
      throw error;
    }
  }

  async markResolved(organizationId: string, deliveryId: string): Promise<void> {
    if (!this.claims.has(`${organizationId}:${deliveryId}`)) return;
    await this.client.gitHubWebhookDelivery.updateMany({
      where: {
        ...this.owned(organizationId, deliveryId),
        status: { in: ["RECEIVED", "RESOLVED"] },
      },
      data: { status: "RESOLVED", failureReason: null },
    });
  }

  async markQueued(organizationId: string, deliveryId: string, scanId: string): Promise<void> {
    if (!this.claims.has(`${organizationId}:${deliveryId}`)) return;
    await this.client.gitHubWebhookDelivery.updateMany({
      where: {
        ...this.owned(organizationId, deliveryId),
        status: { in: ["RECEIVED", "RESOLVED", "QUEUED"] },
      },
      data: { status: "QUEUED", scanId, failureReason: null },
    });
  }

  async markIgnored(organizationId: string, deliveryId: string, reason: string): Promise<void> {
    if (!this.claims.has(`${organizationId}:${deliveryId}`)) return;
    await this.client.gitHubWebhookDelivery.updateMany({
      where: this.owned(organizationId, deliveryId),
      data: {
        status: "IGNORED",
        failureReason: sanitizeText(reason).slice(0, 500),
        processedAt: new Date(),
        nextAttemptAt: null,
      },
    });
  }

  async markProcessed(organizationId: string, deliveryId: string): Promise<void> {
    if (!this.claims.has(`${organizationId}:${deliveryId}`)) return;
    await this.client.gitHubWebhookDelivery.updateMany({
      where: this.owned(organizationId, deliveryId),
      data: { status: "PROCESSED", processedAt: new Date(), nextAttemptAt: null },
    });
  }

  async markFailed(organizationId: string, deliveryId: string, reason: string): Promise<void> {
    if (!this.claims.has(`${organizationId}:${deliveryId}`)) return;
    await this.client.gitHubWebhookDelivery.updateMany({
      where: this.owned(organizationId, deliveryId),
      data: {
        status: "FAILED",
        failureReason: sanitizeText(reason).slice(0, 500),
        nextAttemptAt: new Date(),
      },
    });
  }
}
