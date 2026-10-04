import { Router } from "express";
import type { Request, Response, NextFunction, Router as ExpressRouter } from "express";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

const router: ExpressRouter = Router();

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "development-secret";

function verifyGitHubSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature) {
    return res.status(401).send("No signature found on request");
  }

  const hmac = crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET);
  // Need raw body for verification, assuming express.json() is configured with rawBody or we stringify
  // For simplicity in this demo, we'll verify against the stringified body.
  // In a real app you'd use verify option in bodyParser to capture raw body.
  const payload = JSON.stringify(req.body);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return next();
  } else {
    return res.status(401).send("Signature verification failed");
  }
}

router.post("/github", verifyGitHubSignature, (req: Request, res: Response) => {
  const event = req.headers["x-github-event"];
  if (event !== "pull_request") {
    res.status(200).send("Ignored event");
    return;
  }

  const payload = req.body as { action?: string, pull_request?: { number: number }, repository?: { full_name: string } };
  const action = payload.action;
  const pull_request = payload.pull_request;
  const repository = payload.repository;

  if (!action || !["opened", "synchronize", "reopened"].includes(action)) {
    res.status(200).send("Ignored PR action");
    return;
  }

  try {
    const scanId = randomUUID();

    // Send a status update to GitHub (placeholder)
    // eslint-disable-next-line no-console
    console.log(`[GitHub Webhook] Received PR #${pull_request?.number} for ${repository?.full_name}`);
    // eslint-disable-next-line no-console
    console.log(`[GitHub Webhook] Simulating queue for PR validation...`);

    // We'll queue it or process it in background. For now we just return 202.
    res.status(202).json({ message: "Scan queued", scanId });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).send("Error processing webhook");
  }
});

export default router;
