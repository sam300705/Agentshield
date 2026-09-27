import { Router, Request, Response } from "express";
import { QueueEvents } from "bullmq";
import * as IORedis from "ioredis";
import { authenticate } from "../middleware/auth.js";

const router: Router = Router();
const Redis = (IORedis as any).default || IORedis.Redis || IORedis;

const redisConnection = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

const queueEvents = new QueueEvents("scannerQueue", { connection: redisConnection });
queueEvents.setMaxListeners(0);

router.get("/:scanId/stream", authenticate, (req: Request, res: Response) => {
  const { scanId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ message: "Connected to scan stream", scanId })}\n\n`);

  const onProgress = (args: { jobId: string; data: any }) => {
    if (args.jobId === scanId) {
      res.write(`data: ${JSON.stringify({ event: "progress", jobId: args.jobId, data: args.data })}\n\n`);
    }
  };

  const onCompleted = (args: { jobId: string; returnvalue: any; prev?: string }) => {
    if (args.jobId === scanId) {
      res.write(`data: ${JSON.stringify({ event: "completed", jobId: args.jobId, returnvalue: args.returnvalue })}\n\n`);
    }
  };

  const onFailed = (args: { jobId: string; failedReason: string; prev?: string }) => {
    if (args.jobId === scanId) {
      res.write(`data: ${JSON.stringify({ event: "failed", jobId: args.jobId, failedReason: args.failedReason })}\n\n`);
    }
  };

  queueEvents.on("progress", onProgress);
  queueEvents.on("completed", onCompleted);
  queueEvents.on("failed", onFailed);

  req.on("close", () => {
    queueEvents.off("progress", onProgress);
    queueEvents.off("completed", onCompleted);
    queueEvents.off("failed", onFailed);
    res.end();
  });
});

export default router;
