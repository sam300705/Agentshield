import { describe, expect, it, vi } from "vitest";

import type { VerifiedGitHubWebhook } from "./githubApp.js";
import type { GitHubDeliveryStore } from "./githubDeliveryStore.js";
import {
  processGitHubWebhookDelivery,
  type GitHubWebhookLifecycleClient,
} from "./githubWebhookLifecycle.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

function makeWebhook(
  eventName: string,
  payload: Record<string, unknown>,
  repositoryFullName = "octo/example",
  action: string | null = "opened",
): VerifiedGitHubWebhook {
  return {
    deliveryId: `delivery-${eventName}-${action ?? "none"}`,
    eventName,
    action,
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

type TestLifecycleClient = GitHubWebhookLifecycleClient & {
  repositoryFindFirst: ReturnType<typeof vi.fn>;
  repositoryUpdateMany: ReturnType<typeof vi.fn>;
  installationUpdateMany: ReturnType<typeof vi.fn>;
};

function makeClient(
  installation: {
    id: string;
    organizationId: string;
    accountLogin: string;
    installationId: number;
    status?: string;
  } | null = {
    id: "installation-row",
    organizationId: "org-test",
    accountLogin: "octo-org",
    installationId: 42,
    status: "ACTIVE",
  },
  repository: { id: string; fullName: string; defaultBranch: string } | null = {
    id: "repository-row",
    fullName: "octo/example",
    defaultBranch: "main",
  },
): TestLifecycleClient {
  const repositoryFindFirst = vi.fn(() => Promise.resolve(repository));
  const repositoryUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
  const installationUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
  const installationRecord =
    installation == null ? null : { ...installation, status: installation.status ?? "ACTIVE" };
  return {
    gitHubInstallation: {
      findUnique: vi.fn(() => Promise.resolve(installationRecord)),
      updateMany: installationUpdateMany,
    },
    repository: {
      findFirst: repositoryFindFirst,
      updateMany: repositoryUpdateMany,
    },
    repositoryFindFirst,
    repositoryUpdateMany,
    installationUpdateMany,
  };
}

describe("processGitHubWebhookDelivery", () => {
  it("resolves a mapped push, pins after SHA, and queues trusted PUSH provenance", async () => {
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
      "github:delivery-push-opened",
      "org-test",
      "github:webhook",
      "corr-test",
      {
        trigger: "PUSH",
        webhook: {
          deliveryId: "delivery-push-opened",
          eventName: "push",
          action: "opened",
        },
      },
    );
    expect(store.calls.map(({ method }) => method)).toEqual(["markResolved", "markQueued"]);
  });

  it("pins a pull-request head and never attributes it as MANUAL", async () => {
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
      {
        trigger: "PULL_REQUEST",
        webhook: {
          deliveryId: "delivery-pull_request-opened",
          eventName: "pull_request",
          action: "opened",
        },
      },
    );
  });

  it("immediately revokes a suspended installation and detaches its repositories", async () => {
    const store = makeStore();
    const client = makeClient();
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("installation", {}, null as unknown as string, "suspend"),
      "corr-suspend",
      {
        client,
        deliveryStore: store,
        scanLifecycleEnabled: false,
      },
    );

    expect(result).toEqual({ status: "PROCESSED", scanQueued: false });
    expect(client.installationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "installation-row",
        organizationId: "org-test",
        installationId: 42,
      },
      data: { status: "SUSPENDED" },
    });
    expect(client.repositoryUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-test", githubInstallationId: "installation-row" },
      data: { githubInstallationId: null },
    });
    expect(store.calls.at(-1)?.method).toBe("markProcessed");
  });

  it("canonically resynchronizes signed repository-access changes", async () => {
    const store = makeStore();
    const synchronizeInstallation = vi.fn(() => Promise.resolve());
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("installation_repositories", {}, "octo/example", "added"),
      "corr-repositories",
      {
        client: makeClient(),
        deliveryStore: store,
        scanLifecycleEnabled: false,
        synchronizeInstallation,
      },
    );

    expect(result).toEqual({ status: "PROCESSED", scanQueued: false });
    expect(synchronizeInstallation).toHaveBeenCalledWith("org-test", 42);
    expect(store.calls.at(-1)?.method).toBe("markProcessed");
  });

  it("can recover a previously suspended installation only through canonical resync", async () => {
    const store = makeStore();
    const synchronizeInstallation = vi.fn(() => Promise.resolve());
    const client = makeClient({
      id: "installation-row",
      organizationId: "org-test",
      accountLogin: "octo-org",
      installationId: 42,
      status: "SUSPENDED",
    });
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("installation", {}, "octo/example", "unsuspend"),
      "corr-unsuspend",
      {
        client,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        synchronizeInstallation,
      },
    );

    expect(result).toEqual({ status: "PROCESSED", scanQueued: false });
    expect(synchronizeInstallation).toHaveBeenCalledWith("org-test", 42);
  });

  it.each([
    ["unknown installation", makeClient(null), "UNKNOWN_INSTALLATION"],
    [
      "cross-org installation",
      makeClient({
        id: "installation-row",
        organizationId: "other-org",
        accountLogin: "octo-org",
        installationId: 42,
      }),
      "UNKNOWN_INSTALLATION",
    ],
    [
      "inactive installation",
      makeClient({
        id: "installation-row",
        organizationId: "org-test",
        accountLogin: "octo-org",
        installationId: 42,
        status: "SUSPENDED",
      }),
      "UNKNOWN_INSTALLATION",
    ],
    [
      "installation login mismatch",
      makeClient({
        id: "installation-row",
        organizationId: "org-test",
        accountLogin: "different-org",
        installationId: 42,
      }),
      "UNKNOWN_INSTALLATION",
    ],
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

  it("binds repository lookup to the resolved installation row", async () => {
    const store = makeStore();
    const client = makeClient();
    const enqueueScan = vi.fn(() =>
      Promise.resolve({ id: "job", scanId: "scan", status: "QUEUED" as const }),
    );
    await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("push", { ref: "refs/heads/main", after: commitSha }),
      "corr-bind",
      {
        client,
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        enqueueScan,
      },
    );
    expect(client.repositoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-test",
          provider: "GITHUB",
          fullName: "octo/example",
          githubInstallationId: "installation-row",
        },
      }),
    );
  });

  it("rejects invalid or short webhook commit SHAs", async () => {
    const store = makeStore();
    const enqueueScan = vi.fn();
    const result = await processGitHubWebhookDelivery(
      "org-test",
      makeWebhook("push", { ref: "refs/heads/main", after: "abcdef1" }),
      "corr-bad-sha",
      {
        client: makeClient(),
        deliveryStore: store,
        scanLifecycleEnabled: true,
        policyBundleVersion: "policy-v1",
        enqueueScan,
      },
    );
    expect(result).toEqual({ status: "IGNORED", reason: "INVALID_COMMIT", scanQueued: false });
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("ignores unsupported events and disables scan events without creating jobs", async () => {
    const store = makeStore();
    const enqueueScan = vi.fn();
    const base = {
      client: makeClient(),
      deliveryStore: store,
      scanLifecycleEnabled: false,
      enqueueScan,
    };
    await expect(
      processGitHubWebhookDelivery("org-test", makeWebhook("issues", {}), "corr-issues", {
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
      args: ["org-test", "delivery-push-opened", "QUEUE_FAILED"],
    });
  });
});
