import "dotenv/config";

import { prisma } from "./db/prisma.js";
import { processNextScanJob } from "./services/scanQueue.js";

const workerId = `scan-worker-${process.pid}`;
const runOnce = process.env.WORKER_MODE === "once";
let stopping = false;

async function run(): Promise<void> {
  console.warn(
    JSON.stringify({
      level: "info",
      service: "agentshield-worker",
      workerId,
      message: "worker started",
    }),
  );
  while (!stopping) {
    const processed = await processNextScanJob(workerId);
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

async function shutdown(signal: string): Promise<void> {
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
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

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
