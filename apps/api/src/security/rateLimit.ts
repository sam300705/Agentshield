import type { NextFunction, Request, RequestHandler, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  enabled: boolean;
  max: number;
  windowMs: number;
  keyForRequest?: (request: Request, response: Response) => string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (request: Request, response: Response, next: NextFunction) => {
    if (!options.enabled) {
      next();
      return;
    }

    const now = Date.now();
    const actor = response.locals.actor as { organizationId?: unknown; id?: unknown } | undefined;
    const defaultKey =
      typeof actor?.organizationId === "string" && typeof actor.id === "string"
        ? `organization:${actor.organizationId}:user:${actor.id}:route:${request.method}:${request.path}`
        : `ip:${request.ip || "unknown"}:route:${request.method}:${request.path}`;
    const key = options.keyForRequest?.(request, response) ?? defaultKey;
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
          correlationId:
            typeof response.getHeader("x-correlation-id") === "string"
              ? response.getHeader("x-correlation-id")
              : "unknown",
        },
      });
      return;
    }

    next();
  };
}
