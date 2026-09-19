import { beforeEach, describe, expect, it, vi } from "vitest";

type CountResult = { count: number };
type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};
type AuditCreateArgs = {
  data: {
    actor: string;
    entityType: string;
    organizationId: string;
    metadata: Record<string, unknown>;
    [key: string]: unknown;
  };
};
type ScanJobRecord = {
  id: string;
  scanId: string;
  attempts: number;
  maxAttempts: number;
  failureCode: string | null;
  failureMessage: string | null;
  deadLetteredAt: Date;
};
type CheckPublicationRecord = {
  id: string;
  scanId: string;
  attempts: number;
  maxAttempts: number;
  failureMessage: string | null;
  deadLetteredAt: Date;
  checkRunId: string | null;
};

const fake = vi.hoisted(() => ({
  transaction: vi.fn<(callback: (client: unknown) => Promise<unknown>) => Promise<unknown>>(),
  scanJobFindFirst: vi.fn<(args: unknown) => Promise<ScanJobRecord | null>>(),
  scanJobUpdateMany: vi.fn<(args: UpdateManyArgs) => Promise<CountResult>>(),
  scanUpdateMany: vi.fn<(args: UpdateManyArgs) => Promise<CountResult>>(),
  checkFindFirst: vi.fn<(args: unknown) => Promise<CheckPublicationRecord | null>>(),
  checkUpdateMany: vi.fn<(args: UpdateManyArgs) => Promise<CountResult>>(),
  auditCreate: vi.fn<(args: AuditCreateArgs) => Promise<{ id: string }>>(),
}));

vi.mock("../db/prisma.js", () => ({
  prisma: { $transaction: fake.transaction },
}));

const { retryDeadLetteredGitHubCheckPublication, retryDeadLetteredScan } =
  await import("./operatorRecovery.js");

beforeEach(() => {
  vi.clearAllMocks();
  fake.transaction.mockImplementation((callback) =>
    callback({
      scanJob: {
        findFirst: fake.scanJobFindFirst,
        updateMany: fake.scanJobUpdateMany,
      },
      scan: { updateMany: fake.scanUpdateMany },
      gitHubCheckPublication: {
        findFirst: fake.checkFindFirst,
        updateMany: fake.checkUpdateMany,
      },
      auditEvent: { create: fake.auditCreate },
    }),
  );
  fake.scanJobUpdateMany.mockResolvedValue({ count: 1 });
  fake.scanUpdateMany.mockResolvedValue({ count: 1 });
  fake.checkUpdateMany.mockResolvedValue({ count: 1 });
  fake.auditCreate.mockResolvedValue({ id: "audit-1" });
});

describe("operator dead-letter recovery", () => {
  it("revives one dead-lettered scan and records its previous failure context", async () => {
    const deadLetteredAt = new Date("2026-09-11T09:00:00Z");
    fake.scanJobFindFirst.mockResolvedValue({
      id: "job-1",
      scanId: "scan-1",
      attempts: 3,
      maxAttempts: 3,
      failureCode: "RETRIES_EXHAUSTED",
      failureMessage: "scanner failed",
      deadLetteredAt,
    });

    await expect(retryDeadLetteredScan("scan-1", "org-1", "admin-1", "corr-1")).resolves.toEqual({
      id: "job-1",
      scanId: "scan-1",
      status: "QUEUED",
    });

    const scanJobUpdate = fake.scanJobUpdateMany.mock.calls.at(0)?.[0];
    expect(scanJobUpdate).toBeDefined();
    expect(scanJobUpdate?.where.id).toBe("job-1");
    expect(scanJobUpdate?.where.deadLetteredAt).toBe(deadLetteredAt);
    expect(scanJobUpdate?.data.status).toBe("QUEUED");
    expect(scanJobUpdate?.data.attempts).toBe(0);
    expect(scanJobUpdate?.data.deadLetteredAt).toBeNull();

    const audit = fake.auditCreate.mock.calls.at(0)?.[0];
    expect(audit).toBeDefined();
    expect(audit?.data.actor).toBe("admin-1");
    expect(audit?.data.entityType).toBe("ScanJob");
    expect(audit?.data.organizationId).toBe("org-1");
    expect(audit?.data.metadata.operation).toBe("SCAN_RETRY_REQUESTED");
    expect(audit?.data.metadata.previousAttempts).toBe(3);
    expect(audit?.data.metadata.previousFailureCode).toBe("RETRIES_EXHAUSTED");
  });

  it("does not revive a scan that is not explicitly dead-lettered", async () => {
    fake.scanJobFindFirst.mockResolvedValue(null);
    await expect(retryDeadLetteredScan("scan-1", "org-1", "admin-1", "corr-2")).resolves.toBeNull();
    expect(fake.scanJobUpdateMany).not.toHaveBeenCalled();
    expect(fake.auditCreate).not.toHaveBeenCalled();
  });

  it("revives Check publication while preserving its remote Check identity", async () => {
    const deadLetteredAt = new Date("2026-09-11T09:05:00Z");
    fake.checkFindFirst.mockResolvedValue({
      id: "publication-1",
      scanId: "scan-1",
      attempts: 6,
      maxAttempts: 6,
      failureMessage: "github unavailable",
      deadLetteredAt,
      checkRunId: "987654",
    });

    await expect(
      retryDeadLetteredGitHubCheckPublication("scan-1", "org-1", "admin-1", "corr-3"),
    ).resolves.toEqual({ id: "publication-1", scanId: "scan-1", status: "PENDING" });

    const checkUpdate = fake.checkUpdateMany.mock.calls.at(0)?.[0];
    expect(checkUpdate).toBeDefined();
    expect(checkUpdate?.where.id).toBe("publication-1");
    expect(checkUpdate?.where.deadLetteredAt).toBe(deadLetteredAt);
    expect(checkUpdate?.data.status).toBe("PENDING");
    expect(checkUpdate?.data.attempts).toBe(0);
    expect(checkUpdate?.data.deadLetteredAt).toBeNull();
    expect(Object.hasOwn(checkUpdate?.data ?? {}, "checkRunId")).toBe(false);

    const audit = fake.auditCreate.mock.calls.at(0)?.[0];
    expect(audit).toBeDefined();
    expect(audit?.data.entityType).toBe("GitHubCheckPublication");
    expect(audit?.data.metadata.operation).toBe("GITHUB_CHECK_PUBLICATION_RETRY_REQUESTED");
    expect(audit?.data.metadata.reconcilesCheckRunId).toBe("987654");
  });
});
