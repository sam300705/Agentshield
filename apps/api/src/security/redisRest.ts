import { z } from "zod";
import type { RateLimitDecision, RateLimitStore } from "./distributedRateLimit.js";

// One Redis operation establishes both counter and TTL. Never retry a possibly applied increment.
export const RATE_LIMIT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {n, ttl}`;
const resultSchema = z.object({
  result: z.tuple([z.number().int().positive(), z.number().int().nonnegative()]),
});

export class RedisRestRateLimitStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async increment(key: string, windowMs: number): Promise<RateLimitDecision> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", RATE_LIMIT_SCRIPT, "1", key, String(windowMs)]),
    });
    if (!response.ok) throw new Error("RATE_LIMIT_STORE_UNAVAILABLE");
    const body = await response.text();
    if (body.length > 4096) throw new Error("RATE_LIMIT_STORE_INVALID_RESPONSE");
    const {
      result: [count, ttl],
    } = resultSchema.parse(JSON.parse(body));
    return { count, resetAt: Date.now() + ttl };
  }
}
