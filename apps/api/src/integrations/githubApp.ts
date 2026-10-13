import { parseGitHubWebhookPayload } from "@agentshield/schemas";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface GitHubAppConfig {
  appId: string;
  clientId: string;
  webhookSecret: string;
  privateKey: string;
}

export interface GitHubInstallationBinding {
  organizationId: string;
  installationId: number;
  accountLogin: string;
  accountType?: string | null;
}

export interface VerifiedGitHubWebhook {
  deliveryId: string;
  eventName: string;
  action: string | null;
  installationId: number;
  organizationLogin: string | null;
  repositoryFullName: string | null;
  repositoryOwnerLogin?: string | null;
  installationAccountLogin?: string | null;
  payload: Record<string, unknown>;
}

export interface GitHubRepository {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string | null;
  permissions: { admin: boolean; push: boolean; pull: boolean };
}

export interface GitHubAppClient {
  createInstallationToken(installationId: number): Promise<{ token: string; expiresAt: Date }>;
  listInstallationRepositories(installationId: number, token: string): Promise<GitHubRepository[]>;
}

const MAX_DELIVERIES = 10_000;

function safeHeader(value: string | undefined, name: string): string {
  if (value == null || value.length === 0 || value.length > 256) {
    throw new Error(`Missing or invalid GitHub ${name} header.`);
  }
  return value;
}

export function verifyGitHubWebhookSignature(
  payload: Buffer | string,
  signature: string | undefined,
  webhookSecret: string,
): boolean {
  if (
    webhookSecret.length === 0 ||
    signature == null ||
    !/^sha256=[a-f0-9]{64}$/i.test(signature)
  ) {
    return false;
  }
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", webhookSecret).update(payload).digest("hex")}`,
    "utf8",
  );
  const supplied = Buffer.from(signature, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export class WebhookReplayGuard {
  private readonly deliveries = new Map<string, number>();

  constructor(private readonly ttlMs = 15 * 60_000) {}

  accept(deliveryId: string, now = Date.now()): boolean {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(deliveryId)) return false;
    for (const [knownDelivery, expiresAt] of this.deliveries) {
      if (expiresAt <= now) this.deliveries.delete(knownDelivery);
    }
    if (this.deliveries.has(deliveryId)) return false;
    if (this.deliveries.size >= MAX_DELIVERIES) {
      const oldest = this.deliveries.keys().next().value;
      if (typeof oldest === "string") this.deliveries.delete(oldest);
    }
    this.deliveries.set(deliveryId, now + this.ttlMs);
    return true;
  }
}

export function parseVerifiedGitHubWebhook(
  rawPayload: Buffer,
  headers: {
    signature?: string;
    delivery?: string;
    event?: string;
  },
  webhookSecret: string,
  replayGuard?: WebhookReplayGuard,
): VerifiedGitHubWebhook {
  if (rawPayload.length > 1024 * 1024) throw new Error("GitHub webhook body exceeds limit.");
  if (!verifyGitHubWebhookSignature(rawPayload, headers.signature, webhookSecret)) {
    throw new Error("GitHub webhook signature verification failed.");
  }
  const deliveryId = safeHeader(headers.delivery, "delivery");
  const eventName = safeHeader(headers.event, "event");
  const value: unknown = JSON.parse(rawPayload.toString("utf8"));
  if (typeof value !== "object" || value == null || !("installation" in value))
    throw new Error("GitHub webhook installation context is required.");
  const parsed = parseGitHubWebhookPayload(eventName, value);
  // Invalid signed input must not poison replay state.
  if (replayGuard != null && !replayGuard.accept(deliveryId))
    throw new Error("GitHub webhook delivery has already been processed.");
  return {
    deliveryId,
    eventName,
    action: parsed.action ?? null,
    installationId: parsed.installation.id,
    organizationLogin: parsed.organization?.login ?? null,
    repositoryFullName: parsed.repository?.full_name ?? null,
    repositoryOwnerLogin: parsed.repository?.owner?.login ?? null,
    installationAccountLogin: parsed.installation.account?.login ?? null,
    payload: parsed,
  };
}

export function assertInstallationOwnership(
  binding: GitHubInstallationBinding,
  webhook: Pick<
    VerifiedGitHubWebhook,
    "installationId" | "organizationLogin" | "repositoryOwnerLogin" | "installationAccountLogin"
  >,
): void {
  const owner =
    binding.accountType === "User"
      ? (webhook.repositoryOwnerLogin ?? webhook.installationAccountLogin)
      : (webhook.organizationLogin ?? webhook.installationAccountLogin);
  if (
    binding.installationId !== webhook.installationId ||
    owner == null ||
    binding.accountLogin.toLowerCase() !== owner.toLowerCase()
  ) {
    throw new Error("GitHub installation does not belong to the organization context.");
  }
}
