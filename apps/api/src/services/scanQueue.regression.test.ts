import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  scanJob: {
    fields: { maxAttempts: "maxAttempts" },
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
  scan: { findUnique: vi.fn(), updateMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("../db/prisma.js", () => ({ prisma: db }));
import { enqueueRepositoryScan, processNextScanJob, recoverAbandonedJobs } from "./scanQueue.js";

const payload = {
  organizationId: "org",
  repositoryId: "repo",
  provider: "LOCAL",
  repositoryName: "repo",
  ref: "main",
  policyBundleVersion: "2026.06.0",
  trigger: "MANUAL",
  requester: "user",
  correlationId: "corr",
  options: {},
};
const candidate = {
  id: "job",
  scanId: "scan",
  status: "QUEUED",
  payload,
  attempts: 1,
  maxAttempts: 3,
  cancelRequestedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
  db.scanJob.findUnique.mockResolvedValue(candidate);
  db.scanJob.findMany.mockResolvedValue([]);
  db.scanJob.findFirst.mockResolvedValue(candidate);
  db.scanJob.findUniqueOrThrow.mockResolvedValue(candidate);
  db.scanJob.updateMany.mockResolvedValue({ count: 1 });
  db.scan.findUnique.mockResolvedValue({ status: "RUNNING" });
  db.scan.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
});
describe("scan queue lifecycle regressions", () => {
  it("releases shutdown-aborted work for retry without consuming an attempt", async () => {
    const controller = new AbortController();
    await processNextScanJob(
      "worker",
      {
        execute: () => {
          controller.abort();
          return Promise.reject(new Error("aborted"));
        },
      },
      controller.signal,
    );
    expect(db.scanJob.updateMany).toHaveBeenLastCalledWith(
      contains({
        data: contains({
          status: "QUEUED",
          failureCode: "WORKER_SHUTDOWN",
          attempts: { decrement: 1 },
          deadLetteredAt: null,
        }),
      }),
    );
  });
  it("preserves a scan which completed during shutdown", async () => {
    const controller = new AbortController();
    db.scan.findUnique.mockResolvedValue({ status: "COMPLETED" });
    await processNextScanJob(
      "worker",
      {
        execute: () => {
          controller.abort();
          return Promise.reject(new Error("late abort"));
        },
      },
      controller.signal,
    );
    expect(db.scanJob.updateMany).toHaveBeenLastCalledWith(
      contains({ data: contains({ status: "COMPLETED" }) }),
    );
    expect(db.scan.updateMany).not.toHaveBeenCalled();
  });
  it("cancels only explicit cancellation requests", async () => {
    const cancelled = { ...candidate, cancelRequestedAt: new Date() };
    db.scanJob.findUniqueOrThrow.mockResolvedValue(cancelled);
    db.scanJob.findUnique.mockResolvedValue(cancelled);
    await processNextScanJob("worker", { execute: vi.fn() });
    expect(db.scanJob.updateMany).toHaveBeenLastCalledWith(
      contains({ data: contains({ status: "CANCELLED" }) }),
    );
  });
  it("lets cancellation arriving under the failure lock win shutdown classification", async () => {
    const controller = new AbortController();
    db.scanJob.findUnique.mockResolvedValue({ ...candidate, cancelRequestedAt: new Date() });
    await processNextScanJob(
      "worker",
      {
        execute: () => {
          controller.abort();
          return Promise.reject(new Error("shutdown"));
        },
      },
      controller.signal,
    );
    const transition = db.scanJob.updateMany.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>;
    };
    expect(transition.data.status).toBe("CANCELLED");
    expect(transition.data.failureCode).toBe("CANCELLED");
    expect(transition.data.attempts).toBeUndefined();
    expect(transition.data.nextAttemptAt).toBeNull();
  });
  it("excludes dead letters and exhausted retries at selection and claim", async () => {
    await processNextScanJob("worker", { execute: () => Promise.resolve("scan") });
    expect(db.scanJob.findFirst).toHaveBeenCalledWith(
      contains({
        where: contains({
          status: { in: ["QUEUED", "FAILED"] },
          deadLetteredAt: null,
          attempts: { lt: "maxAttempts" },
        }),
      }),
    );
    expect((db.scanJob.updateMany.mock.calls[0]?.[0] as { where: unknown }).where).toMatchObject({
      deadLetteredAt: null,
      attempts: { lt: "maxAttempts" },
    });
  });
  it("lets a renewed lease win stale-job recovery without changing scan state", async () => {
    db.scanJob.findMany.mockResolvedValue([{ id: "job", scanId: "scan" }]);
    db.scanJob.updateMany.mockResolvedValue({ count: 0 });
    const now = new Date();
    expect(await recoverAbandonedJobs(now)).toBe(0);
    expect(db.scanJob.updateMany).toHaveBeenCalledWith(
      contains({
        where: contains({
          OR: includes([{ leaseExpiresAt: { lt: now } }]),
        }),
      }),
    );
    expect(db.scan.updateMany).not.toHaveBeenCalled();
  });
});

it("returns the scoped winner after a repository idempotency race", async () => {
  db.scanJob.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: "winner", scanId: "scan", status: "QUEUED" });
  db.$transaction.mockRejectedValueOnce(
    new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" }),
  );
  expect(
    await enqueueRepositoryScan(
      {
        repositoryId: "repo",
        ref: "main",
        policyBundleVersion: "2026.06.0",
        options: {
          maxFiles: 1000,
          maxBytes: 1000,
          timeoutMs: 1000,
          ignorePaths: [],
          includeOsv: false,
        },
      },
      "same-key",
      "org",
      "user",
      "corr",
    ),
  ).toEqual({ id: "winner", scanId: "scan", status: "QUEUED" });
  expect(db.scanJob.findUnique).toHaveBeenLastCalledWith({
    where: { idempotencyKey: "org:same-key" },
  });
});

function contains(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value) as unknown;
}
function includes(value: unknown[]): unknown {
  return expect.arrayContaining(value) as unknown;
}

it.each([false, true])(
  "final-attempt recovery is terminal with cancellation=%s",
  async (cancelled) => {
    db.scanJob.findMany.mockResolvedValue([{ id: "job", scanId: "scan" }]);
    db.scanJob.findUnique.mockResolvedValue({
      ...candidate,
      attempts: 3,
      maxAttempts: 3,
      cancelRequestedAt: cancelled ? new Date() : null,
    });
    db.scanJob.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date();
    expect(await recoverAbandonedJobs(now)).toBe(1);
    const transition = db.scanJob.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(transition.data.nextAttemptAt).toBeNull();
    expect(transition.data.failureCode).toBe(cancelled ? "CANCELLED" : "MAX_ATTEMPTS_EXCEEDED");
    if (!cancelled) expect(transition.data.deadLetteredAt).toEqual(now);
    const scan = db.scan.updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scan.data.completedAt).toEqual(now);
  },
);
