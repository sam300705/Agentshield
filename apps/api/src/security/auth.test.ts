import { describe, expect, it } from "vitest";

import { canIndependentlyApprove, hasPermission, type RequestActor } from "./auth.js";

const reviewer: RequestActor = {
  id: "reviewer-1",
  role: "SECURITY_REVIEWER",
  organizationId: "org-1",
  demo: true,
};

describe("RBAC and separation of duties", () => {
  it("enforces role permissions", () => {
    expect(hasPermission("VIEWER", "scan:read")).toBe(true);
    expect(hasPermission("VIEWER", "scan:run")).toBe(false);
    expect(hasPermission("POLICY_ADMINISTRATOR", "policy:manage")).toBe(true);
  });

  it("prevents an authorized reviewer from approving their own request", () => {
    expect(canIndependentlyApprove(reviewer, "reviewer-1")).toBe(false);
    expect(canIndependentlyApprove(reviewer, "developer-1")).toBe(true);
  });
});
