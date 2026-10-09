import type { NextFunction, Request, RequestHandler, Response } from "express";

import { getCorrelationId } from "./auth.js";

export interface RateLimitDecision {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitDecision>;
}

export interface RedisLikeRateLimitClient {
  incr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<unknown>;
  pTtl(key: string): Promise<number>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitDecision>();

  constructor(private readonly maxBuckets = 10_000) {}

  increment(key: string, windowMs: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket =
      current == null || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.maxBuckets) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }
    return Promise.resolve(bucket);
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisLikeRateLimitClient) {}

  async increment(key: string, windowMs: number): Promise<RateLimitDecision> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.pExpire(key, windowMs);
    const ttl = await this.client.pTtl(key);
    return { count, resetAt: Date.now() + Math.max(0, ttl) };
  }
}

export interface DistributedRateLimitOptions {
  enabled: boolean;
  max: number;
  windowMs: number;
  store: RateLimitStore;
  keyForRequest?: (request: Request, response: Response) => string;
  onStoreError?: "fail-closed" | "fail-open";
}

function setHeaders(
  response: Response,
  options: DistributedRateLimitOptions,
  decision: RateLimitDecision,
): void {
  response.setHeader("RateLimit-Limit", options.max);
  response.setHeader("RateLimit-Remaining", Math.max(0, options.max - decision.count));
  response.setHeader("RateLimit-Reset", Math.ceil(decision.resetAt / 1000));
}

export function createDistributedRateLimiter(options: DistributedRateLimitOptions): RequestHandler {
  const keyForRequest =
    options.keyForRequest ??
    ((request: Request, response: Response) => {
      const actor = response.locals.actor as { organizationId?: unknown; id?: unknown } | undefined;
      return typeof actor?.organizationId === "string" && typeof actor.id === "string"
        ? `organization:${actor.organizationId}:user:${actor.id}:route:${request.method}:${request.path}`
        : `ip:${request.ip || "unknown"}:route:${request.method}:${request.path}`;
    });
  const handleRequest = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!options.enabled) {
      next();
      return;
    }
    try {
      const decision = await options.store.increment(
        keyForRequest(request, response),
        options.windowMs,
      );
      setHeaders(response, options, decision);
      if (decision.count > options.max) {
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again later.",
            correlationId: getCorrelationId(response),
          },
        });
        return;
      }
      next();
    } catch {
      if (options.onStoreError === "fail-open") {
        next();
        return;
      }
      response.status(503).json({
        error: {
          code: "RATE_LIMIT_UNAVAILABLE",
          message: "Request protection is temporarily unavailable.",
          correlationId: getCorrelationId(response),
        },
      });
    }
  };
  return (request, response, next) => {
    void handleRequest(request, response, next);
  };
}
