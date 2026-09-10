import { createHmac, timingSafeEqual } from "node:crypto";

export interface GitHubAppConfig {
  appId: string;
  clientId?: string;
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

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function parseVerifiedGitHubWebhook(
  headers: Record<string, string | undefined>,
  rawBody: Buffer,
  webhookSecret: string,
): VerifiedGitHubWebhook {
  const signature = headers["x-hub-signature-256"];
  if (!verifyGitHubWebhookSignature(rawBody, signature, webhookSecret)) {
    throw new Error("Invalid GitHub webhook signature.");
  }

  const deliveryId = safeHeader(headers["x-github-delivery"], "delivery");
  const eventName = safeHeader(headers["x-github-event"], "event");
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw new Error("Invalid GitHub webhook JSON payload.");
  }
  const body = readObject(payload);
  if (body == null) throw new Error("Invalid GitHub webhook payload.");

  const installation = readObject(body.installation);
  const installationId = readPositiveInteger(installation?.id);
  if (installationId == null) throw new Error("GitHub webhook installation context is required.");

  const repository = readObject(body.repository);
  const repositoryFullName = readString(repository?.full_name, 256);
  const organization = readObject(body.organization);
  const sender = readObject(body.sender);
  const organizationLogin =
    readString(organization?.login, 128) ?? readString(sender?.login, 128) ?? null;

  return {
    deliveryId,
    eventName,
    action: readString(body.action, 128),
    installationId,
    organizationLogin,
    repositoryFullName,
    payload: body,
  };
}

export function assertInstallationOwnership(
  binding: GitHubInstallationBinding,
  webhook: VerifiedGitHubWebhook,
): void {
  if (binding.installationId !== webhook.installationId) {
    throw new Error("GitHub installation does not match the verified webhook.");
  }
  if (
    webhook.organizationLogin != null &&
    binding.accountLogin.toLowerCase() !== webhook.organizationLogin.toLowerCase()
  ) {
    throw new Error("GitHub webhook organization does not match the registered installation.");
  }
}
