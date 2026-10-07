import "./env.js";

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { recordWorkerHealth } from "./workerHealth.js";
import { getRuntimeConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { createGitHubExecutor, githubClientFromEnvironment } from "./integrations/githubRuntime.js";
import { publishGitHubChecks } from "./integrations/githubCheckPublisher.js";
import { processNextScanJob } from "./services/scanQueue.js";

const workerId = `scan-worker-${hostname()}-${process.pid}-${randomUUID()}`;
const runOnce = process.env.WORKER_MODE === "once";
const shutdownController = new AbortController();
let stopping = false;

async function run(): Promise<void> {
  const config = getRuntimeConfig();
  const github = config.githubMaterializationEnabled ? githubClientFromEnvironment() : null;
  const executor = github == null ? undefined : createGitHubExecutor(prisma, github);
  console.warn(
    JSON.stringify({
      level: "info",
      service: "agentshield-worker",
      workerId,
      message: "worker started",
    }),
  );
  await recordWorkerHealth("starting");
  await prisma.$queryRaw`SELECT 1`;
  await recordWorkerHealth("running");
  const healthTimer = setInterval(() => {
    void prisma.$queryRaw`SELECT 1`
      .then(() => recordWorkerHealth(stopping ? "stopping" : "running"))
      .catch(() => recordWorkerHealth("unavailable"))
      .catch(() => undefined);
  }, 10_000);
  try {
    while (!stopping) {
      if (process.env.WORKER_PAUSED === "true") {
        if (runOnce) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (github != null && process.env.GITHUB_CHECKS_PAUSED !== "true")
        await publishGitHubChecks(prisma, github);
      const processed = await processNextScanJob(workerId, executor, shutdownController.signal);
      if (github != null && process.env.GITHUB_CHECKS_PAUSED !== "true")
        await publishGitHubChecks(prisma, github);
      if (!processed && runOnce) break;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (runOnce) {
      console.warn(
        JSON.stringify({
          level: "info",
          service: "agentshield-worker",
          workerId,
          message: "worker batch complete",
        }),
      );
    }
  } finally {
    clearInterval(healthTimer);
    await recordWorkerHealth("stopping");
    await prisma.$disconnect();
  }
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.warn(
    JSON.stringify({
      level: "info",
      service: "agentshield-worker",
      workerId,
      signal,
      message: "worker stopping",
    }),
  );
  // Drain the current job with its heartbeat active. A forced process exit leaves
  // the durable lease for normal stale recovery; shutdown is not user cancellation.
  setTimeout(() => process.exit(1), 110_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

run().catch(() => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "agentshield-worker",
      workerId,
      message: "Worker stopped after an internal failure.",
    }),
  );
  process.exitCode = 1;
});
