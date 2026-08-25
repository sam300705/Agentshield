import type { NextFunction, Request, RequestHandler, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  enabled: boolean;
  max: number;
  windowMs: number;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (request: Request, response: Response, next: NextFunction) => {
    if (!options.enabled) {
      next();
      return;
    }

    const now = Date.now();
    const key = request.ip || "unknown";
    const current = buckets.get(key);
    const bucket =
      current == null || current.resetAt <= now
        ? { count: 0, resetAt: now + options.windowMs }
        : current;
    bucket.count += 1;
    buckets.set(key, bucket);

    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    const remaining = Math.max(0, options.max - bucket.count);
    response.setHeader("RateLimit-Limit", options.max);
    response.setHeader("RateLimit-Remaining", remaining);
    response.setHeader("RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > options.max) {
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again later.",
        },
      });
      return;
    }

    next();
  };
}
