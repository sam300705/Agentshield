import type { RequestHandler } from "express";

import type { RuntimeConfig } from "../config.js";
import {
  createDistributedRateLimiter,
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  RedisRestRateLimitClient,
} from "./distributedRateLimit.js";

export interface RateLimitCompositionDependencies {
  fetchImpl?: typeof fetch;
}

export function createConfiguredRateLimiter(
  config: RuntimeConfig,
  dependencies: RateLimitCompositionDependencies = {},
): RequestHandler {
  const store =
    config.RATE_LIMIT_BACKEND === "redis-rest"
      ? new RedisRateLimitStore(
          new RedisRestRateLimitClient(
            config.RATE_LIMIT_REDIS_REST_URL ?? "",
            config.RATE_LIMIT_REDIS_REST_TOKEN ?? "",
            dependencies.fetchImpl ?? fetch,
            config.RATE_LIMIT_REDIS_TIMEOUT_MS,
          ),
        )
      : new InMemoryRateLimitStore();

  return createDistributedRateLimiter({
    enabled: config.rateLimitEnabled,
    max: config.RATE_LIMIT_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    store,
    onStoreError: config.NODE_ENV === "production" ? "fail-closed" : "fail-open",
  });
}
