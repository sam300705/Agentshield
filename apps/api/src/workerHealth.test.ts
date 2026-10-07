import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
it("requires a recent running private worker marker", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentshield-health-test-"));
  const file = path.join(directory, "health.json");
  vi.stubEnv("WORKER_HEALTH_FILE", file);
  const { checkWorkerHealth, recordWorkerHealth } = await import("./workerHealth.js");
  try {
    expect(await checkWorkerHealth()).toBe(false);
    await recordWorkerHealth("running");
    expect(await checkWorkerHealth()).toBe(true);
    await recordWorkerHealth("stopping");
    expect(await checkWorkerHealth()).toBe(false);
    await writeFile(file, JSON.stringify({ state: "running", heartbeatAt: Date.now() - 60_000 }));
    expect(await checkWorkerHealth()).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
