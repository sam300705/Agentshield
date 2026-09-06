import { describe, expect, it } from "vitest";

import { calculateRetryDelayMs, SCAN_HEARTBEAT_MS, SCAN_LEASE_MS } from "./scanQueue.js";

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
});
