import { createRepositoryScanSchema } from "@agentshield/schemas";

import { assertInstallationOwnership, type VerifiedGitHubWebhook } from "./githubApp.js";
import type { GitHubDeliveryStore } from "./githubDeliveryStore.js";
import { enqueueRepositoryScan } from "../services/scanQueue.js";

const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/i;

export interface GitHubWebhookLifecycleClient {
  gitHubInstallation: {
    findUnique(args: {
      where: { installationId: number };
      select: {
        id: true;
        organizationId: true;
        accountLogin: true;
        installationId: true;
      };
    }): Promise<{
      id: string;
      organizationId: string;
      accountLogin: string;
      installationId: number;
    } | null>;
  };
  repository: {
    findFirst(args: {
      where: {
        organizationId: string;
        provider: string;
        fullName: string;
        githubInstallationId: string;
      };
      select: { id: true; fullName: true; defaultBranch: true };
    }): Promise<{ id: string; fullName: string; defaultBranch: string } | null>;
  };
}

export interface GitHubWebhookLifecycleOptions {
  client: GitHubWebhookLifecycleClient;
  deliveryStore: GitHubDeliveryStore;
  scanLifecycleEnabled: boolean;
  policyBundleVersion?: string;
  enqueueScan?: typeof enqueueRepositoryScan;
}

export type GitHubWebhookLifecycleResult =
  | { status: "DISABLED"; scanQueued: false }
  | { status: "IGNORED"; reason: string; scanQueued: false }
  | { status: "QUEUED"; scanQueued: true; scanId: string; jobId: string }
  | { status: "FAILED"; reason: "QUEUE_FAILED"; scanQueued: false };

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function readCommitContext(
  webhook: VerifiedGitHubWebhook,
): { ref: string; commitSha: string } | null {
  const payload = webhook.payload;
  if (webhook.eventName === "push") {
    const ref = readString(payload.ref);
    const commitSha = readString(payload.after, 64);
    return ref != null && commitSha != null && FULL_COMMIT_SHA.test(commitSha)
      ? { ref, commitSha }
      : null;
  }
  if (webhook.eventName === "pull_request") {
    const pullRequest = readObject(payload.pull_request);
    const head = readObject(pullRequest?.head);
    const ref = readString(head?.ref);
    const commitSha = readString(head?.sha, 64);
    return ref != null && commitSha != null && FULL_COMMIT_SHA.test(commitSha)
      ? { ref, commitSha }
      : null;
  }
  return null;
}

export async function processGitHubWebhookDelivery(
  organizationId: string,
  webhook: VerifiedGitHubWebhook,
  correlationId: string,
  options: GitHubWebhookLifecycleOptions,
): Promise<GitHubWebhookLifecycleResult> {
  if (!options.scanLifecycleEnabled || options.policyBundleVersion == null) {
    await options.deliveryStore.markIgnored(
      organizationId,
      webhook.deliveryId,
      "LIFECYCLE_DISABLED",
    );
    return { status: "DISABLED", scanQueued: false };
  }

  if (webhook.eventName !== "push" && webhook.eventName !== "pull_request") {
    await options.deliveryStore.markIgnored(
      organizationId,
      webhook.deliveryId,
      "UNSUPPORTED_EVENT",
    );
    return { status: "IGNORED", reason: "UNSUPPORTED_EVENT", scanQueued: false };
  }

  if (webhook.repositoryFullName == null) {
    await options.deliveryStore.markIgnored(
      organizationId,
      webhook.deliveryId,
      "UNKNOWN_REPOSITORY",
    );
    return { status: "IGNORED", reason: "UNKNOWN_REPOSITORY", scanQueued: false };
  }

  const installation = await options.client.gitHubInstallation.findUnique({
    where: { installationId: webhook.installationId },
    select: { id: true, organizationId: true, accountLogin: true, installationId: true },
  });
  if (installation == null || installation.organizationId !== organizationId) {
    await options.deliveryStore.markIgnored(
      organizationId,
      webhook.deliveryId,
      "UNKNOWN_INSTALLATION",
    );
    return { status: "IGNORED", reason: "UNKNOWN_INSTALLATION", scanQueued: false };
  }
  try {
    assertInstallationOwnership(installation, webhook);
  } catch {
    await options.deliveryStore.markIgnored(
      organizationId,
      webhook.deliveryId,
      "UNKNOWN_INSTALLATION",
    );
    return { status: "IGNORED", reason: "UNKNOWN_INSTALLATION", scanQueued: false };
  }

  const repository = await options.client.repository.findFirst({
    where: {
      organizationId,
      provider: "GITHUB",
      fullName: webhook.repositoryFullName,
      githubInstallationId: installation.id,
    },
    select: { id: true, fullName: true, defaultBranch: true },
  });
  if (repository == null) {
    await options.deliveryStore.markIgnored(
      organizationId,
      webhook.deliveryId,
      "UNKNOWN_REPOSITORY",
    );
    return { status: "IGNORED", reason: "UNKNOWN_REPOSITORY", scanQueued: false };
  }

  const commitContext = readCommitContext(webhook);
  if (commitContext == null) {
    await options.deliveryStore.markIgnored(organizationId, webhook.deliveryId, "INVALID_COMMIT");
    return { status: "IGNORED", reason: "INVALID_COMMIT", scanQueued: false };
  }

  await options.deliveryStore.markResolved(organizationId, webhook.deliveryId);
  const request = createRepositoryScanSchema.parse({
    repositoryId: repository.id,
    ref: commitContext.ref || repository.defaultBranch,
    commitSha: commitContext.commitSha,
    policyBundleVersion: options.policyBundleVersion,
    options: {},
  });
  try {
    const job = await (options.enqueueScan ?? enqueueRepositoryScan)(
      request,
      `github:${webhook.deliveryId}`,
      organizationId,
      "github:webhook",
      correlationId,
    );
    await options.deliveryStore.markQueued(organizationId, webhook.deliveryId, job.scanId);
    return { status: "QUEUED", scanQueued: true, scanId: job.scanId, jobId: job.id };
  } catch {
    await options.deliveryStore.markFailed(organizationId, webhook.deliveryId, "QUEUE_FAILED");
    return { status: "FAILED", reason: "QUEUE_FAILED", scanQueued: false };
  }
}
