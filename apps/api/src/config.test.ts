import { describe, expect, it } from "vitest";

import { getRuntimeConfig } from "./config.js";

const validProductionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@example.com:5432/agentshield",
  CORS_ORIGIN: "https://dashboard.example.com",
  AUTH_MODE: "oidc",
  OIDC_ISSUER: "https://issuer.example.com",
  OIDC_AUDIENCE: "agentshield-api",
  OIDC_JWKS_URL: "https://issuer.example.com/.well-known/jwks.json",
  OIDC_ROLE_CLAIM: "roles",
};

describe("runtime configuration", () => {
  it("accepts complete production OIDC configuration", () => {
    const config = getRuntimeConfig(validProductionEnv);

    expect(config.corsOrigin).toBe("https://dashboard.example.com");
    expect(config.rateLimitEnabled).toBe(true);
  });

  it("rejects production without an exact CORS origin", () => {
    expect(() => getRuntimeConfig({ ...validProductionEnv, CORS_ORIGIN: undefined })).toThrow(
      "CORS_ORIGIN is required",
    );
  });

  it("rejects demo authentication in production", () => {
    expect(() => getRuntimeConfig({ ...validProductionEnv, DEMO_AUTH_ENABLED: "true" })).toThrow(
      "DEMO_AUTH_ENABLED must be false or unset in production",
    );
  });

  it("allows explicitly enabled local demo mode without OIDC values", () => {
    const config = getRuntimeConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:secret@localhost:5432/agentshield",
      CORS_ORIGIN: "http://localhost:5173",
      AUTH_MODE: "oidc",
      DEMO_AUTH_ENABLED: "true",
    });

    expect(config.corsOrigin).toBe("http://localhost:5173");
    expect(config.rateLimitEnabled).toBe(false);
  });

  it("rejects enabled GitHub webhooks without a secret", () => {
    expect(() =>
      getRuntimeConfig({
        ...validProductionEnv,
        GITHUB_WEBHOOK_ENABLED: "true",
      }),
    ).toThrow("GITHUB_WEBHOOK_SECRET is required");
  });

  it("accepts explicitly enabled GitHub webhooks with a secret", () => {
    const config = getRuntimeConfig({
      ...validProductionEnv,
      GITHUB_WEBHOOK_ENABLED: "true",
      GITHUB_WEBHOOK_SECRET: "synthetic-webhook-secret",
    });

    expect(config.githubWebhookEnabled).toBe(true);
  });

  it("treats blank optional template values as unset", () => {
    const config = getRuntimeConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:secret@localhost:5432/agentshield",
      CORS_ORIGIN: "http://localhost:5173",
      AUTH_MODE: "oidc",
      DEMO_AUTH_ENABLED: "true",
      OIDC_ISSUER: "",
      OIDC_AUDIENCE: "",
      OIDC_JWKS_URL: "",
      RATE_LIMIT_ENABLED: "",
    });

    expect(config.OIDC_ISSUER).toBeUndefined();
    expect(config.rateLimitEnabled).toBe(false);
  });
});
