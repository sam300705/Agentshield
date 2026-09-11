import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  transaction: vi.fn(),
  scanJobFindFirst: vi.fn(),
  scanJobUpdateMany: vi.fn(),
  scanUpdateMany: vi.fn(),
  checkFindFirst: vi.fn(),
  checkUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({
  prisma: { $transaction: fake.transaction },
}));

const { retryDeadLetteredGitHubCheckPublication, retryDeadLetteredScan } =
  await import("./operatorRecovery.js");

beforeEach(() => {
  vi.clearAllMocks();
  fake.transaction.mockImplementation((callback: (client: unknown) => Promise<unknown>) =>
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

    await expect(
      retryDeadLetteredScan("scan-1", "org-1", "admin-1", "corr-1"),
    ).resolves.toEqual({ id: "job-1", scanId: "scan-1", status: "QUEUED" });
    expect(fake.scanJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1", deadLetteredAt }),
        data: expect.objectContaining({ attempts: 0, deadLetteredAt: null, status: "QUEUED" }),
      }),
    );
    expect(fake.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "admin-1",
        entityType: "ScanJob",
        organizationId: "org-1",
        metadata: expect.objectContaining({
          operation: "SCAN_RETRY_REQUESTED",
          previousAttempts: 3,
          previousFailureCode: "RETRIES_EXHAUSTED",
        }),
      }),
    });
  });

  it("does not revive a scan that is not explicitly dead-lettered", async () => {
    fake.scanJobFindFirst.mockResolvedValue(null);
    await expect(
      retryDeadLetteredScan("scan-1", "org-1", "admin-1", "corr-2"),
    ).resolves.toBeNull();
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
    expect(fake.checkUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "publication-1", deadLetteredAt }),
        data: expect.not.objectContaining({ checkRunId: null }),
      }),
    );
    expect(fake.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "GitHubCheckPublication",
        metadata: expect.objectContaining({
          operation: "GITHUB_CHECK_PUBLICATION_RETRY_REQUESTED",
          reconcilesCheckRunId: "987654",
        }),
      }),
    });
  });
});
