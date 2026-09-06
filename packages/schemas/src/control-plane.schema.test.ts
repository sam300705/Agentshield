import { describe, expect, it } from "vitest";

import { policyBundleSchema, securityReceiptSchema } from "./control-plane.schema.js";

describe("control plane contracts", () => {
  it("rejects policy versions that are not semantic versions", () => {
    const result = policyBundleSchema.safeParse({
      id: "bundle",
      name: "Production",
      version: "latest",
      environment: "PRODUCTION",
      status: "ACTIVE",
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects receipts with malformed hashes", () => {
    const result = securityReceiptSchema.safeParse({
      id: "r",
      scanId: "s",
      repository: "o/r",
      branch: "main",
      commitSha: "abc",
      scannerVersion: "1",
      policyBundleVersion: "1",
      findingCounts: {},
      decisionCounts: {},
      approvalState: "NONE",
      evidenceDigest: "not-a-hash",
      startedAt: new Date(),
      completedAt: new Date(),
      gateResult: "ALLOW",
      receiptHash: "not-a-hash",
    });
    expect(result.success).toBe(false);
  });
});
