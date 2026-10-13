import { afterEach, describe, expect, it, vi } from "vitest";

import { canIndependentlyApprove, hasPermission, mapRole, type RequestActor } from "./auth.js";

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

afterEach(() => vi.unstubAllEnvs());
it("uses exclusively the configured role claim and fails closed when absent", () => {
  vi.stubEnv("OIDC_ROLE_CLAIM", "agentshield_roles");
  expect(mapRole({ roles: ["ORGANIZATION_ADMINISTRATOR"], role: "DEVELOPER" })).toBeNull();
  expect(mapRole({ agentshield_roles: [], roles: ["ORGANIZATION_ADMINISTRATOR"] })).toBeNull();
  expect(mapRole({ agentshield_roles: ["VIEWER"], roles: ["ORGANIZATION_ADMINISTRATOR"] })).toBe(
    "VIEWER",
  );
});
