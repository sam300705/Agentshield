import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { RATE_LIMIT_SCRIPT } from "./redisRest.js";
import { getCorrelationId } from "./auth.js";

export interface RateLimitDecision {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitDecision>;
}

export interface RedisLikeRateLimitClient {
  eval(script: string, keys: string[], arguments_: string[]): Promise<unknown>;
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
    if (this.buckets.size > this.maxBuckets) {
      this.buckets.delete(key);
      return Promise.reject(new Error("RATE_LIMIT_CAPACITY"));
    }
    return Promise.resolve(bucket);
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisLikeRateLimitClient) {}

  async increment(key: string, windowMs: number): Promise<RateLimitDecision> {
    const result = await this.client.eval(RATE_LIMIT_SCRIPT, [key], [String(windowMs)]);
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      !Number.isSafeInteger(result[0]) ||
      !Number.isSafeInteger(result[1]) ||
      Number(result[0]) < 1 ||
      Number(result[1]) < 0
    )
      throw new Error("RATE_LIMIT_STORE_INVALID_RESPONSE");
    return { count: Number(result[0]), resetAt: Date.now() + Number(result[1]) };
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
      const identity =
        typeof actor?.organizationId === "string" && typeof actor.id === "string"
          ? `${actor.organizationId}:${actor.id}`
          : request.ip || "unknown";
      const category =
        request.path === "/api/v1/integrations/github/webhooks"
          ? "webhook"
          : ["GET", "HEAD"].includes(request.method)
            ? "read"
            : "mutation";
      return `agentshield:limit:${category}:${createHash("sha256").update(identity).digest("hex")}`;
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
