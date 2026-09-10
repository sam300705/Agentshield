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

interface RedisRestResponse {
  result?: unknown;
  error?: unknown;
}

export class RedisRestRateLimitClient implements RedisLikeRateLimitClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 2_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    if (this.baseUrl.length === 0 || token.length === 0) {
      throw new Error("Redis REST rate-limit configuration is incomplete.");
    }
  }

  private async command(command: string, ...args: Array<string | number>): Promise<unknown> {
    const response = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command, ...args]),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Redis REST rate-limit request failed with status ${response.status}.`);
    }
    const payload = (await response.json()) as RedisRestResponse;
    if (payload.error != null) throw new Error("Redis REST rate-limit command failed.");
    return payload.result;
  }

  async incr(key: string): Promise<number> {
    const result = await this.command("INCR", key);
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 1) {
      throw new Error("Redis REST returned an invalid INCR result.");
    }
    return result;
  }

  async pExpire(key: string, milliseconds: number): Promise<unknown> {
    return this.command("PEXPIRE", key, milliseconds);
  }

  async pTtl(key: string): Promise<number> {
    const result = await this.command("PTTL", key);
    if (typeof result !== "number" || !Number.isSafeInteger(result)) {
      throw new Error("Redis REST returned an invalid PTTL result.");
    }
    return result;
  }
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
    if (ttl < 0) {
      throw new Error("Redis rate-limit bucket has no expiry.");
    }
    return { count, resetAt: Date.now() + ttl };
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
