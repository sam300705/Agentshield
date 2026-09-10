import { beforeEach, describe, expect, it, vi } from "vitest";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

const fake = vi.hoisted(() => {
  const repositoryFindFirst = vi.fn();
  const scanCreate = vi.fn();
  const scanJobCreate = vi.fn();
  const scanJobFindUnique = vi.fn();
  const transaction = vi.fn();
  return {
    repositoryFindFirst,
    scanCreate,
    scanJobCreate,
    scanJobFindUnique,
    transaction,
  };
});

vi.mock("../db/prisma.js", () => ({
  prisma: {
    scanJob: { findUnique: fake.scanJobFindUnique },
    $transaction: fake.transaction,
  },
}));

const { enqueueRepositoryScan } = await import("./scanQueue.js");

function request() {
  return {
    repositoryId: "repo-1",
    ref: "refs/heads/main",
    commitSha: COMMIT_SHA,
    policyBundleVersion: "policy-v1",
    options: {
      maxFiles: 10_000,
      maxBytes: 100_000_000,
      timeoutMs: 120_000,
      ignorePaths: [],
      includeOsv: false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.scanJobFindUnique.mockResolvedValue(null);
  fake.repositoryFindFirst.mockResolvedValue({
    id: "repo-1",
    provider: "GITHUB",
    fullName: "octo/example",
    defaultBranch: "main",
    githubInstallation: { installationId: 42 },
  });
  fake.scanCreate.mockResolvedValue({ id: "scan-1" });
  fake.scanJobCreate.mockResolvedValue({
    id: "job-1",
    scanId: "scan-1",
    status: "QUEUED",
  });
  fake.transaction.mockImplementation((callback: (client: unknown) => Promise<unknown>) =>
    callback({
      repository: { findFirst: fake.repositoryFindFirst },
      scan: { create: fake.scanCreate },
      scanJob: { create: fake.scanJobCreate },
    }),
  );
});

describe("enqueueRepositoryScan trusted lineage", () => {
  it("persists server-resolved installation identity for a manual GitHub scan", async () => {
    await enqueueRepositoryScan(request(), "manual-key-1", "org-1", "user-1", "corr-1");

    expect(fake.repositoryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "repo-1", organizationId: "org-1" },
      }),
    );
    const createCall = fake.scanJobCreate.mock.calls[0]?.[0] as {
      data?: { trigger?: string; payload?: unknown };
    };
    expect(createCall.data?.trigger).toBe("MANUAL");
    expect(createCall.data?.payload).toMatchObject({
      organizationId: "org-1",
      repositoryId: "repo-1",
      provider: "GITHUB",
      repositoryName: "octo/example",
      commitSha: COMMIT_SHA,
      trigger: "MANUAL",
      github: {
        installationId: 42,
        repositoryFullName: "octo/example",
      },
    });
    expect(createCall.data?.payload).not.toHaveProperty("integrationId");
  });

  it("persists webhook provenance and never rewrites PUSH to MANUAL", async () => {
    await enqueueRepositoryScan(request(), "push-key-1", "org-1", "github:webhook", "corr-2", {
      trigger: "PUSH",
      webhook: {
        deliveryId: "delivery-1",
        eventName: "push",
        action: "synchronize",
      },
    });

    const createCall = fake.scanJobCreate.mock.calls[0]?.[0] as {
      data?: { trigger?: string; payload?: unknown };
    };
    expect(createCall.data?.trigger).toBe("PUSH");
    expect(createCall.data?.payload).toMatchObject({
      trigger: "PUSH",
      github: {
        installationId: 42,
        repositoryFullName: "octo/example",
        deliveryId: "delivery-1",
        eventName: "push",
        action: "synchronize",
      },
    });
    const scanCall = fake.scanCreate.mock.calls[0]?.[0] as {
      data?: { metadata?: unknown };
    };
    expect(scanCall.data?.metadata).toMatchObject({
      source: "PUSH",
      deliveryId: "delivery-1",
      eventName: "push",
    });
  });

  it("rejects trigger/event spoofing before the first scan write", async () => {
    await expect(
      enqueueRepositoryScan(request(), "spoof-key-1", "org-1", "github:webhook", "corr-3", {
        trigger: "PULL_REQUEST",
        webhook: { deliveryId: "delivery-2", eventName: "push" },
      }),
    ).rejects.toThrow("GitHub webhook event does not match the trusted scan trigger");
    expect(fake.scanCreate).not.toHaveBeenCalled();
    expect(fake.scanJobCreate).not.toHaveBeenCalled();
  });

  it("rejects a GitHub repository with no registered installation before writes", async () => {
    fake.repositoryFindFirst.mockResolvedValue({
      id: "repo-1",
      provider: "GITHUB",
      fullName: "octo/example",
      defaultBranch: "main",
      githubInstallation: null,
    });

    await expect(
      enqueueRepositoryScan(request(), "missing-install-1", "org-1", "user-1", "corr-4"),
    ).rejects.toThrow("GitHub repository is not bound to an active installation");
    expect(fake.scanCreate).not.toHaveBeenCalled();
    expect(fake.scanJobCreate).not.toHaveBeenCalled();
  });

  it("rejects a short GitHub commit SHA before writes", async () => {
    await expect(
      enqueueRepositoryScan(
        { ...request(), commitSha: "abcdef1" },
        "short-sha-1",
        "org-1",
        "user-1",
        "corr-5",
      ),
    ).rejects.toThrow("GitHub provider scans require an immutable 40-character commit SHA");
    expect(fake.scanCreate).not.toHaveBeenCalled();
  });

  it("returns an existing organization-scoped idempotent job without new writes", async () => {
    fake.scanJobFindUnique.mockResolvedValue({
      id: "existing-job",
      scanId: "existing-scan",
      status: "QUEUED",
    });

    await expect(
      enqueueRepositoryScan(request(), "same-key-123", "org-1", "user-1", "corr-6"),
    ).resolves.toEqual({ id: "existing-job", scanId: "existing-scan", status: "QUEUED" });
    expect(fake.scanJobFindUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "org-1:same-key-123" },
    });
    expect(fake.transaction).not.toHaveBeenCalled();
  });
});
