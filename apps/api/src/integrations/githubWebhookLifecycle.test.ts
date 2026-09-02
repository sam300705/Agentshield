import { describe, expect, it, vi } from "vitest";

import type { VerifiedGitHubWebhook } from "./githubApp.js";
import {
  processGitHubWebhookDelivery,
  type GitHubWebhookLifecycleClient,
} from "./githubWebhookLifecycle.js";
import type { GitHubDeliveryStore } from "./githubDeliveryStore.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

function makeWebhook(
  eventName: string,
  payload: Record<string, unknown>,
  repositoryFullName = "octo/example",
): VerifiedGitHubWebhook {
  return {
    deliveryId: `delivery-${eventName}`,
    eventName,
    action: "opened",
    installationId: 42,
    organizationLogin: "octo-org",
    repositoryFullName,
    payload,
  };
}

function makeStore(): GitHubDeliveryStore & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve();
    });
  return {
    calls,
    claim: vi.fn(() => Promise.resolve(true)),
    markResolved: record("markResolved"),
    markQueued: record("markQueued"),
    markIgnored: record("markIgnored"),
    markProcessed: record("markProcessed"),
    markFailed: record("markFailed"),
  };
}

function makeClient(
  installation: {
    id: string;
    organizationId: string;
    accountLogin: string;
    installationId: number;
  } | null = {
    id: "installation-row",
    organizationId: "org-test",
    accountLogin: "octo-org",
    installationId: 42,
  },
  repository: { id: string; fullName: string; defaultBranch: string } | null = {
    id: "repository-row",
    fullName: "octo/example",
    defaultBranch: "main",
  },
): GitHubWebhookLifecycleClient {
  return {
    gitHubInstallation: {
      findUnique: vi.fn(() => Promise.resolve(installation)),
    },
    repository: {
      findFirst: vi.fn(() => Promise.resolve(repository)),
    },
  };
}

describe("processGitHubWebhookDelivery", () => {
  it("resolves a mapped push, pins after SHA, and queues one idempotent scan", async () => {
    const store = makeStore();
    const client = makeClient();
    const enqueueScan = vi.fn(() =>
      Promise.resolve({ id: "job-row", scanId: "scan-row", status: "QUEUED" as const }),
    );
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("push", { ref: "refs/heads/main", after: commitSha }),
      "corr-test",
      {
        client,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        enqueueScan,
      },
    );

    expect(result).toEqual({
      status: "QUEUED",
      scanQueued: true,
      scanId: "scan-row",
      jobId: "job-row",
    });
    expect(enqueueScan).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repository-row",
        ref: "refs/heads/main",
        commitSha,
        policyBundleVersion: "policy-v1",
      }),
      "github:delivery-push",
      "org-test",
      "github:webhook",
      "corr-test",
    );
    expect(store.calls.map(({ method }) => method)).toEqual(["markResolved", "markQueued"]);
  });

  it("pins a pull-request head rather than a floating merge ref", async () => {
    const store = makeStore();
    const enqueueScan = vi.fn(() =>
      Promise.resolve({ id: "job", scanId: "scan", status: "QUEUED" as const }),
    );
    const headSha = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("pull_request", {
        pull_request: { head: { ref: "feature/security", sha: headSha } },
      }),
      "corr-pr",
      {
        client: makeClient(),
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        enqueueScan,
      },
    );
    expect(result.status).toBe("QUEUED");
    expect(enqueueScan).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "feature/security", commitSha: headSha }),
      expect.any(String),
      "org-test",
      "github:webhook",
      "corr-pr",
    );
  });

  it.each([
    ["unknown installation", makeClient(null), "UNKNOWN_INSTALLATION"],
    ["unknown repository", makeClient(undefined, null), "UNKNOWN_REPOSITORY"],
  ] as const)("does not enqueue for %s", async (_name, client, reason) => {
    const store = makeStore();
    const enqueueScan = vi.fn();
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("push", { ref: "refs/heads/main", after: commitSha }),
      "corr-test",
      {
        client,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        enqueueScan,
      },
    );
    expect(result).toEqual({ status: "IGNORED", reason, scanQueued: false });
    expect(enqueueScan).not.toHaveBeenCalled();
    expect(store.calls.at(-1)).toEqual({
      method: "markIgnored",
      args: ["org-test", expect.any(String), reason],
    });
  });

  it("ignores unsupported events and disabled lifecycle without creating jobs", async () => {
    const store = makeStore();
    const enqueueScan = vi.fn();
    const base = {
      client: makeClient(),
      deliveryStore: store,
      scanLifecycleEnabled: false,
      enqueueScan,
    };
    await expect(
      processGitHubWebhookDelivery("org-test", makeWebhook("installation", {}), "corr-install", {
        ...base,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
      }),
    ).resolves.toEqual({ status: "IGNORED", reason: "UNSUPPORTED_EVENT", scanQueued: false });
    await expect(
      processGitHubWebhookDelivery(
        "org-test",
        makeWebhook("push", { ref: "refs/heads/main", after: commitSha }),
        "corr-disabled",
        base,
      ),
    ).resolves.toEqual({ status: "DISABLED", scanQueued: false });
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("records deterministic queue failure without claiming a scan was queued", async () => {
    const store = makeStore();
    const enqueueScan = vi.fn(() => Promise.reject(new Error("provider failure")));
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("push", { ref: "refs/heads/main", after: commitSha }),
      "corr-failure",
      {
        client: makeClient(),
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        enqueueScan,
      },
    );
    expect(result).toEqual({ status: "FAILED", reason: "QUEUE_FAILED", scanQueued: false });
    expect(store.calls.at(-1)).toEqual({
      method: "markFailed",
      args: ["org-test", "delivery-push", "QUEUE_FAILED"],
    });
  });
});
