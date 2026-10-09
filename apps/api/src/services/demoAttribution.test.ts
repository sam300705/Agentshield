import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), run: vi.fn(), configured: vi.fn() }));
vi.mock("./scanQueue.js", () => ({ enqueueDemoScan: mocks.enqueue }));
vi.mock("./scanService.js", () => ({
  runDemoScan: mocks.run,
  runConfiguredScan: mocks.configured,
}));
vi.mock("../security/auth.js", () => ({
  getActor: () => ({ id: "caller-1", organizationId: "org-1" }),
  getCorrelationId: () => "corr-1",
}));
import { runDemoScanController } from "../controllers/scanController.js";
import { ConfiguredScanJobExecutor } from "./scanJobExecutor.js";
import type { Request, Response } from "express";
beforeEach(() => vi.clearAllMocks());
it("passes authenticated caller identity into demo queue admission", async () => {
  mocks.enqueue.mockResolvedValue({ id: "job", scanId: "scan", status: "QUEUED" });
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await runDemoScanController(
    { header: () => "idempotency-key" } as unknown as Request,
    res as unknown as Response,
  );
  expect(mocks.enqueue).toHaveBeenCalledWith("idempotency-key", "org-1", "corr-1", "caller-1");
});
it("propagates the persisted requester through local demo execution", async () => {
  const signal = new AbortController().signal;
  mocks.run.mockResolvedValue("scan");
  await new ConfiguredScanJobExecutor().execute({
    scanId: "scan",
    signal,
    payload: {
      organizationId: "org-1",
      repositoryId: "local-demo",
      provider: "LOCAL",
      repositoryName: "demo",
      ref: "main",
      policyBundleVersion: "2026.06.0",
      trigger: "MANUAL",
      requester: "caller-1",
      correlationId: "corr-1",
      options: {},
    },
  });
  expect(mocks.run).toHaveBeenCalledWith("scan", "org-1", "corr-1", signal, "caller-1", undefined);
});
