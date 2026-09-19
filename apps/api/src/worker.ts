import "dotenv/config";

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { sanitizeText } from "@agentshield/schemas";
import { getRuntimeConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import {
  createGitHubCheckAppClient,
  processNextGitHubCheckPublication,
} from "./services/githubCheckPublication.js";
import { processNextScanJob } from "./services/scanQueue.js";
import { createWorkerScanExecutor } from "./services/workerComposition.js";

const workerId = `scan-worker-${hostname()}-${process.pid}-${randomUUID()}`;
const runOnce = process.env.WORKER_MODE === "once";
const shutdownController = new AbortController();
let stopping = false;

async function run(): Promise<void> {
  const config = getRuntimeConfig();
  const executor = await createWorkerScanExecutor(config);
  const githubCheckAppClient = createGitHubCheckAppClient(config);
  console.warn(
    JSON.stringify({
      level: "info",
      service: "agentshield-worker",
      workerId,
      githubChecksEnabled: githubCheckAppClient != null,
      message: "worker started",
    }),
  );
  try {
    while (!stopping) {
      const scanProcessed = await processNextScanJob(workerId, executor, shutdownController.signal);
      if (stopping) break;
      const checkProcessed = await processNextGitHubCheckPublication(
        prisma,
        githubCheckAppClient,
        workerId,
        config.DASHBOARD_PUBLIC_URL,
      );
      const processed = scanProcessed || checkProcessed;
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
  shutdownController.abort();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

run().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "agentshield-worker",
      workerId,
      message: sanitizeText(error instanceof Error ? error.message : "Unknown worker error"),
    }),
  );
  process.exitCode = 1;
});
