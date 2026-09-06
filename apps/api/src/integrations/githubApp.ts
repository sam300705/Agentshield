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
}

export interface VerifiedGitHubWebhook {
  deliveryId: string;
  eventName: string;
  action: string | null;
  installationId: number;
  organizationLogin: string | null;
  repositoryFullName: string | null;
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

function readNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`GitHub webhook ${name} is invalid.`);
  }
  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
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
  if (!verifyGitHubWebhookSignature(rawPayload, headers.signature, webhookSecret)) {
    throw new Error("GitHub webhook signature verification failed.");
  }
  const deliveryId = safeHeader(headers.delivery, "delivery");
  if (replayGuard != null && !replayGuard.accept(deliveryId))
    throw new Error("GitHub webhook delivery has already been processed.");
  const eventName = safeHeader(headers.event, "event");
  const parsed = JSON.parse(rawPayload.toString("utf8")) as Record<string, unknown>;
  const installation = parsed.installation;
  const installationId =
    typeof installation === "object" && installation != null
      ? readNumber((installation as { id?: unknown }).id, "installation.id")
      : null;
  if (installationId == null) throw new Error("GitHub webhook installation context is required.");
  const organization = parsed.organization;
  const organizationLogin =
    typeof organization === "object" && organization != null
      ? readString((organization as { login?: unknown }).login)
      : null;
  const repository = parsed.repository;
  const repositoryFullName =
    typeof repository === "object" && repository != null
      ? readString((repository as { full_name?: unknown }).full_name)
      : null;
  return {
    deliveryId,
    eventName,
    action: readString(parsed.action),
    installationId,
    organizationLogin,
    repositoryFullName,
    payload: parsed,
  };
}

export function assertInstallationOwnership(
  binding: GitHubInstallationBinding,
  webhook: Pick<VerifiedGitHubWebhook, "installationId" | "organizationLogin">,
): void {
  if (
    binding.installationId !== webhook.installationId ||
    webhook.organizationLogin == null ||
    binding.accountLogin.toLowerCase() !== webhook.organizationLogin.toLowerCase()
  ) {
    throw new Error("GitHub installation does not belong to the organization context.");
  }
}
