import { describe, expect, it } from "vitest";

import { simulatePolicy } from "./demoData";

describe("recruiter demo policy simulation", () => {
  it("derives stricter production outcomes from the fixture", () => {
    const result = simulatePolicy("production");
    expect(result.newlyBlocked).toBe(1);
    expect(result.riskDelta).toBeGreaterThan(0);
    expect(result.decisions.find((item) => item.id === "F-187")?.simulated).toBe("BLOCK");
  });
});
