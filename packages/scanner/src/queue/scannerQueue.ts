import { Queue, Worker, Job } from "bullmq";
import * as IORedis from "ioredis";
import { PrismaClient, ScanStatus } from "@prisma/client";

const prisma = new PrismaClient();
const Redis = (IORedis as any).default || IORedis.Redis || IORedis;

const redisConnection = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

export const scannerQueue = new Queue("scannerQueue", {
  connection: redisConnection,
});

export const worker = new Worker(
  "scannerQueue",
  async (job: Job) => {
    const { scanId } = job.data;

    try {
      await prisma.scan.update({
        where: { id: scanId },
        data: { status: ScanStatus.RUNNING },
      });

      // Simulation of scanning work (normally this would run the actual scanRunner logic)
      await job.updateProgress(10);

      // We will leave the job running logic abstract as requested to focus on queue structure
      await job.updateProgress(50);

      // Marking success would happen here or in the actual scanner process
      await job.updateProgress(100);
      return { success: true };
    } catch (error) {
      console.error(`Error processing scan ${scanId}:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

worker.on("failed", async (job, err) => {
  if (job) {
    const { scanId } = job.data;
    try {
      await prisma.scan.update({
        where: { id: scanId },
        data: { status: ScanStatus.FAILED },
      });
      console.error(`Job ${job.id} failed with error ${err.message}`);
    } catch (dbError) {
      console.error(`Failed to update job status to FAILED in DB for scan ${scanId}`, dbError);
    }
  }
});
