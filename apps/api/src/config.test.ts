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
  RATE_LIMIT_BACKEND: "redis-rest",
  RATE_LIMIT_REDIS_REST_URL: "https://redis.example.com",
  RATE_LIMIT_REDIS_REST_TOKEN: "synthetic-rate-limit-token",
};

describe("runtime configuration", () => {
  it("accepts complete production OIDC and distributed rate-limit configuration", () => {
    const config = getRuntimeConfig(validProductionEnv);

    expect(config.corsOrigin).toBe("https://dashboard.example.com");
    expect(config.rateLimitEnabled).toBe(true);
    expect(config.RATE_LIMIT_BACKEND).toBe("redis-rest");
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

  it("rejects disabling rate limiting in production", () => {
    expect(() => getRuntimeConfig({ ...validProductionEnv, RATE_LIMIT_ENABLED: "false" })).toThrow(
      "RATE_LIMIT_ENABLED cannot be disabled in production",
    );
  });

  it("rejects a per-process memory limiter in production", () => {
    expect(() =>
      getRuntimeConfig({
        ...validProductionEnv,
        RATE_LIMIT_BACKEND: "memory",
        RATE_LIMIT_REDIS_REST_URL: undefined,
        RATE_LIMIT_REDIS_REST_TOKEN: undefined,
      }),
    ).toThrow("RATE_LIMIT_BACKEND must be redis-rest in production");
  });

  it("rejects redis-rest limiting without a URL", () => {
    expect(() =>
      getRuntimeConfig({ ...validProductionEnv, RATE_LIMIT_REDIS_REST_URL: undefined }),
    ).toThrow("RATE_LIMIT_REDIS_REST_URL is required");
  });

  it("rejects redis-rest limiting without a token", () => {
    expect(() =>
      getRuntimeConfig({ ...validProductionEnv, RATE_LIMIT_REDIS_REST_TOKEN: undefined }),
    ).toThrow("RATE_LIMIT_REDIS_REST_TOKEN is required");
  });

  it("rejects an insecure Redis REST URL in production", () => {
    expect(() =>
      getRuntimeConfig({
        ...validProductionEnv,
        RATE_LIMIT_REDIS_REST_URL: "http://redis.example.com",
      }),
    ).toThrow("RATE_LIMIT_REDIS_REST_URL must use HTTPS in production");
  });

  it("allows explicitly enabled local demo mode with an in-memory limiter and no OIDC values", () => {
    const config = getRuntimeConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:secret@localhost:5432/agentshield",
      CORS_ORIGIN: "http://localhost:5173",
      AUTH_MODE: "oidc",
      DEMO_AUTH_ENABLED: "true",
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_BACKEND: "memory",
    });

    expect(config.corsOrigin).toBe("http://localhost:5173");
    expect(config.rateLimitEnabled).toBe(true);
    expect(config.RATE_LIMIT_BACKEND).toBe("memory");
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

const SYNTHETIC_KEY_BODY = "U1lOVEhFVElDLVRFVEVTVEtFWQ=="; // base64("SYNTHETIC-TESTKEY")

function syntheticPrivateKeyPem(escaped: boolean): string {
  const lines = ["-----BEGIN PRIVATE KEY-----", SYNTHETIC_KEY_BODY, "-----END PRIVATE KEY-----"];
  return escaped ? lines.join("\\n") : lines.join("\n");
}

const githubLifecycleEnv = {
  GITHUB_WEBHOOK_ENABLED: "true",
  GITHUB_WEBHOOK_SECRET: "[SECURITY_DATA]",
  GITHUB_SCAN_LIFECYCLE_ENABLED: "true",
  GITHUB_SCAN_POLICY_BUNDLE_VERSION: "test-bundle-1.0.0",
  GITHUB_APP_ID: "123456",
  GITHUB_PRIVATE_KEY: syntheticPrivateKeyPem(true),
};

interface ConfigFailureCase {
  name: string;
  env: Record<string, string | undefined>;
  message: string;
}

const githubFailureCases: ConfigFailureCase[] = [
  {
    name: "rejects enabled GitHub webhooks without a secret",
    env: { GITHUB_WEBHOOK_SECRET: undefined, GITHUB_SCAN_LIFECYCLE_ENABLED: undefined },
    message: "GITHUB_WEBHOOK_SECRET is required when GitHub webhook ingestion is enabled",
  },
  {
    name: "rejects lifecycle without webhooks",
    env: { GITHUB_WEBHOOK_ENABLED: undefined },
    message: "GITHUB_WEBHOOK_ENABLED must be true when GitHub scan lifecycle is enabled",
  },
  {
    name: "rejects lifecycle without a policy bundle version",
    env: { GITHUB_SCAN_POLICY_BUNDLE_VERSION: undefined },
    message: "GITHUB_SCAN_POLICY_BUNDLE_VERSION is required when GitHub scan lifecycle is enabled",
  },
  {
    name: "rejects lifecycle without a GitHub App ID",
    env: { GITHUB_APP_ID: undefined },
    message: "GITHUB_APP_ID is required when GitHub scan lifecycle is enabled",
  },
  {
    name: "rejects lifecycle with a non-numeric GitHub App ID",
    env: { GITHUB_APP_ID: "app-one-two-three" },
    message: "GITHUB_APP_ID must be a numeric GitHub App ID when GitHub scan lifecycle is enabled",
  },
  {
    name: "rejects lifecycle without a GitHub App private key",
    env: { GITHUB_PRIVATE_KEY: undefined },
    message: "GITHUB_PRIVATE_KEY is required when GitHub scan lifecycle is enabled",
  },
  {
    name: "rejects lifecycle with a malformed GitHub App private key",
    env: { GITHUB_PRIVATE_KEY: "not-a-pem-private-key" },
    message:
      "GITHUB_PRIVATE_KEY must be a PEM-encoded private key (with BEGIN/END PRIVATE KEY markers) when GitHub scan lifecycle is enabled",
  },
  {
    name: "rejects materialization without lifecycle",
    env: {
      GITHUB_SCAN_LIFECYCLE_ENABLED: undefined,
      GITHUB_MATERIALIZATION_ENABLED: "true",
      GITHUB_APP_ID: undefined,
      GITHUB_PRIVATE_KEY: undefined,
    },
    message: "GITHUB_SCAN_LIFECYCLE_ENABLED must be true when GitHub materialization is enabled",
  },
  {
    name: "rejects Checks publishing without lifecycle",
    env: {
      GITHUB_SCAN_LIFECYCLE_ENABLED: undefined,
      GITHUB_CHECKS_ENABLED: "true",
      GITHUB_APP_ID: undefined,
      GITHUB_PRIVATE_KEY: undefined,
    },
    message: "GITHUB_SCAN_LIFECYCLE_ENABLED must be true when GitHub Checks publishing is enabled",
  },
  {
    name: "rejects an invalid dashboard URL",
    env: { DASHBOARD_PUBLIC_URL: "not-a-url" },
    message: "DASHBOARD_PUBLIC_URL",
  },
];

describe("GitHub capability requirements", () => {
  it.each(githubFailureCases)("$name", ({ env, message }) => {
    expect(() =>
      getRuntimeConfig({ ...validProductionEnv, ...githubLifecycleEnv, ...env }),
    ).toThrow(message);
  });

  it("accepts the full lifecycle stack without a client ID", () => {
    const config = getRuntimeConfig({ ...validProductionEnv, ...githubLifecycleEnv });

    expect(config.githubWebhookEnabled).toBe(true);
    expect(config.githubScanLifecycleEnabled).toBe(true);
    expect(config.GITHUB_CLIENT_ID).toBeUndefined();
  });

  it("normalizes an escaped private key to real newlines", () => {
    const config = getRuntimeConfig({ ...validProductionEnv, ...githubLifecycleEnv });

    expect(config.GITHUB_PRIVATE_KEY).toBe(syntheticPrivateKeyPem(false));
  });

  it("leaves an already-normalized private key untouched", () => {
    const key = syntheticPrivateKeyPem(false);
    const config = getRuntimeConfig({
      ...validProductionEnv,
      ...githubLifecycleEnv,
      GITHUB_PRIVATE_KEY: key,
    });

    expect(config.GITHUB_PRIVATE_KEY).toBe(key);
  });

  it("normalizes CRLF line endings and surrounding whitespace in the private key", () => {
    const config = getRuntimeConfig({
      ...validProductionEnv,
      ...githubLifecycleEnv,
      GITHUB_PRIVATE_KEY: `  -----BEGIN PRIVATE KEY-----\r\n${SYNTHETIC_KEY_BODY}\r\n-----END PRIVATE KEY-----  `,
    });

    expect(config.GITHUB_PRIVATE_KEY).toBe(syntheticPrivateKeyPem(false));
  });

  it("accepts materialization on top of the full lifecycle stack", () => {
    const config = getRuntimeConfig({
      ...validProductionEnv,
      ...githubLifecycleEnv,
      GITHUB_MATERIALIZATION_ENABLED: "true",
    });

    expect(config.githubScanLifecycleEnabled).toBe(true);
    expect(config.githubMaterializationEnabled).toBe(true);
  });

  it("accepts Checks publishing with a dashboard URL for advertised links", () => {
    const config = getRuntimeConfig({
      ...validProductionEnv,
      ...githubLifecycleEnv,
      GITHUB_CHECKS_ENABLED: "true",
      DASHBOARD_PUBLIC_URL: "https://dashboard.example.com",
    });

    expect(config.githubChecksEnabled).toBe(true);
    expect(config.DASHBOARD_PUBLIC_URL).toBe("https://dashboard.example.com");
  });

  it("ignores GitHub credential values when every GitHub capability is disabled", () => {
    const config = getRuntimeConfig({
      ...validProductionEnv,
      GITHUB_APP_ID: "unused-junk",
      GITHUB_PRIVATE_KEY: "unused-junk",
    });

    expect(config.githubWebhookEnabled).toBe(false);
    expect(config.githubScanLifecycleEnabled).toBe(false);
    expect(config.githubMaterializationEnabled).toBe(false);
    expect(config.githubChecksEnabled).toBe(false);
  });
});

describe("configuration error redaction", () => {
  it("never echoes the private key in validation errors", () => {
    let message = "";
    try {
      getRuntimeConfig({
        ...validProductionEnv,
        ...githubLifecycleEnv,
        GITHUB_PRIVATE_KEY: "MARKER-LEAK-PROBE-not-a-pem-key",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("GITHUB_PRIVATE_KEY must be a PEM-encoded private key");
    expect(message).not.toContain("MARKER-LEAK-PROBE");
  });

  it("never echoes the App ID in validation errors", () => {
    let message = "";
    try {
      getRuntimeConfig({
        ...validProductionEnv,
        ...githubLifecycleEnv,
        GITHUB_APP_ID: "MARKER-LEAK-PROBE-ID",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("GITHUB_APP_ID must be a numeric GitHub App ID");
    expect(message).not.toContain("MARKER-LEAK-PROBE");
  });

  it("never echoes the Redis REST token in validation errors", () => {
    let message = "";
    try {
      getRuntimeConfig({
        ...validProductionEnv,
        RATE_LIMIT_REDIS_REST_URL: "http://redis.example.com",
        RATE_LIMIT_REDIS_REST_TOKEN: "MARKER-LEAK-PROBE-RATE-TOKEN",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("RATE_LIMIT_REDIS_REST_URL must use HTTPS in production");
    expect(message).not.toContain("MARKER-LEAK-PROBE");
  });

  it("aggregates missing App credentials without echoing the webhook secret", () => {
    let message = "";
    try {
      getRuntimeConfig({
        ...validProductionEnv,
        GITHUB_WEBHOOK_ENABLED: "true",
        GITHUB_WEBHOOK_SECRET: "[SECURITY_DATA]",
        GITHUB_SCAN_LIFECYCLE_ENABLED: "true",
        GITHUB_SCAN_POLICY_BUNDLE_VERSION: "test-bundle-1.0.0",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("GITHUB_APP_ID is required");
    expect(message).toContain("GITHUB_PRIVATE_KEY is required");
    expect(message).not.toContain("MARKER-LEAK-PROBE");
  });
});
