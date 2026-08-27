import "dotenv/config";

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { getRuntimeConfig } from "./config.js";
import { prisma } from "./db/prisma.js";
import { processNextScanJob } from "./services/scanQueue.js";

const workerId = `scan-worker-${hostname()}-${process.pid}-${randomUUID()}`;
const runOnce = process.env.WORKER_MODE === "once";
const shutdownController = new AbortController();
let stopping = false;

async function run(): Promise<void> {
  getRuntimeConfig();
  console.warn(
    JSON.stringify({
      level: "info",
      service: "agentshield-worker",
      workerId,
      message: "worker started",
    }),
  );
  while (!stopping) {
    const processed = await processNextScanJob(workerId, undefined, shutdownController.signal);
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

run().catch(async (error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "agentshield-worker",
      workerId,
      message: error instanceof Error ? error.message : "Unknown worker error",
    }),
  );
  await prisma.$disconnect();
  process.exitCode = 1;
});
