import type { NextFunction, Request, RequestHandler, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

// Middleware runs before Express resolves request.route: use a finite route family list.
export function rateLimitRouteIdentity(request: Pick<Request, "method" | "path">): string {
  const method = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).has(
    request.method,
  )
    ? request.method
    : "OTHER";
  const path = request.path.replace(/^\/api\/v1(?=\/|$)/, "/api");
  const groups = [
    "scans",
    "repositories",
    "approvals",
    "audit-events",
    "dashboard",
    "agent",
    "agent-approvals",
    "integrations",
    "demo",
    "control-plane",
    "metrics",
    "policies",
    "sessions",
  ];
  const segment = /^\/api\/([^/]+)(?:\/|$)/.exec(path)?.[1];
  const group =
    segment != null && groups.includes(segment)
      ? `api:${segment}`
      : path.startsWith("/health/")
        ? "health"
        : "other";
  return `${method}:${group}`;
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
        ? `organization:${actor.organizationId}:user:${actor.id}:route:${rateLimitRouteIdentity(request)}`
        : `ip:${request.ip || "unknown"}:route:${rateLimitRouteIdentity(request)}`;
    const key = options.keyForRequest?.(request, response) ?? defaultKey;
    if (!buckets.has(key) && buckets.size >= 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
      if (buckets.size >= 10_000) {
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many active request identities. Try again later.",
            correlationId:
              typeof response.getHeader("x-correlation-id") === "string"
                ? response.getHeader("x-correlation-id")
                : "unknown",
          },
        });
        return;
      }
    }
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
