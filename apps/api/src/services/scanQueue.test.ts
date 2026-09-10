import { describe, expect, it } from "vitest";

import {
  calculateRetryDelayMs,
  classifyAbandonedJob,
  SCAN_HEARTBEAT_MS,
  SCAN_LEASE_MS,
} from "./scanQueue.js";

describe("scan queue retry and lease policy", () => {
  it("uses bounded exponential backoff with deterministic injectable jitter", () => {
    expect(calculateRetryDelayMs(1, () => 0)).toBe(1_000);
    expect(calculateRetryDelayMs(2, () => 0)).toBe(2_000);
    expect(calculateRetryDelayMs(3, () => 0.99)).toBe(4_990);
    expect(calculateRetryDelayMs(100, () => 0.99)).toBeLessThanOrEqual(60_000);
  });

  it("renews leases frequently enough to avoid the stale-lock window", () => {
    expect(SCAN_HEARTBEAT_MS).toBeLessThan(SCAN_LEASE_MS);
    expect(SCAN_HEARTBEAT_MS).toBeGreaterThanOrEqual(1_000);
  });

  it("marks an abandoned final attempt for dead-letter instead of retry", () => {
    expect(
      classifyAbandonedJob({ attempts: 3, maxAttempts: 3, cancelRequestedAt: null }),
    ).toBe("DEAD_LETTER");
  });

  it("keeps retryable abandoned work below its attempt budget", () => {
    expect(
      classifyAbandonedJob({ attempts: 2, maxAttempts: 3, cancelRequestedAt: null }),
    ).toBe("RETRY");
  });

  it("prioritizes cancellation over retry or dead-letter recovery", () => {
    expect(
      classifyAbandonedJob({
        attempts: 3,
        maxAttempts: 3,
        cancelRequestedAt: new Date("2026-09-11T00:00:00Z"),
      }),
    ).toBe("CANCEL");
  });
});
