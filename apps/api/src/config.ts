import { createPrivateKey } from "node:crypto";
import { z } from "zod";
import { validateGitHubPrivateKey } from "./integrations/githubApiClient.js";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const booleanFromEnv = z.preprocess(
  blankToUndefined,
  z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
);
const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());
const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalUrl,
  CORS_ORIGIN: optionalUrl,
  AUTH_MODE: z.enum(["oidc", "demo"]).default("oidc"),
  DEMO_AUTH_ENABLED: booleanFromEnv.optional(),
  OIDC_ISSUER: optionalUrl,
  OIDC_AUDIENCE: optionalString,
  OIDC_JWKS_URL: optionalUrl,
  OIDC_ROLE_CLAIM: z.string().min(1).default("roles"),
  METRICS_TOKEN: z.preprocess(blankToUndefined, z.string().min(32).max(256).optional()),
  ERROR_REPORT_URL: optionalUrl,
  ERROR_REPORT_TOKEN: optionalString,
  REDIS_REST_URL: optionalUrl,
  REDIS_REST_TOKEN: optionalString,
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  RECEIPT_SIGNING_REQUIRED: booleanFromEnv,
  RECEIPT_SIGNING_KEY_ID: optionalString,
  RECEIPT_SIGNING_PRIVATE_KEY: optionalString,
  RATE_LIMIT_ENABLED: booleanFromEnv.optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100_000).default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(86_400_000).default(60_000),
  GITHUB_APP_ID: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_WEBHOOK_SECRET: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  GITHUB_WEBHOOK_ENABLED: booleanFromEnv.optional(),
  GITHUB_SCAN_LIFECYCLE_ENABLED: booleanFromEnv.optional(),
  GITHUB_MATERIALIZATION_ENABLED: booleanFromEnv.optional(),
  GITHUB_SCAN_POLICY_BUNDLE_VERSION: optionalString,
});

export type RuntimeConfig = z.infer<typeof baseSchema> & {
  corsOrigin: string;
  rateLimitEnabled: boolean;
  githubWebhookEnabled: boolean;
  githubScanLifecycleEnabled: boolean;
  githubMaterializationEnabled: boolean;
};

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = baseSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${formatIssues(parsed.error)}`);
  }

  const value = parsed.data;
  const issues: string[] = [];
  const isProduction = value.NODE_ENV === "production";
  const demoEnabled = value.DEMO_AUTH_ENABLED === true;
  const corsOrigin = value.CORS_ORIGIN ?? (isProduction ? undefined : "http://localhost:5173");

  if (value.DATABASE_URL == null) issues.push("DATABASE_URL is required");
  if (corsOrigin == null) issues.push("CORS_ORIGIN is required");
  if (isProduction && value.AUTH_MODE !== "oidc") {
    issues.push("AUTH_MODE must be oidc in production");
  }
  if (isProduction && demoEnabled) {
    issues.push("DEMO_AUTH_ENABLED must be false or unset in production");
  }
  if (isProduction) {
    if (value.DATABASE_URL != null) {
      const database = new URL(value.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(database.protocol))
        issues.push("DATABASE_URL must be PostgreSQL");
      if (!["require", "verify-full"].includes(database.searchParams.get("sslmode") ?? ""))
        issues.push("DATABASE_URL requires sslmode=require or verify-full in production");
    }
    if (value.RATE_LIMIT_ENABLED === false)
      issues.push("RATE_LIMIT_ENABLED cannot be false in production");
    if (value.REDIS_REST_URL == null || value.REDIS_REST_TOKEN == null)
      issues.push("REDIS_REST_URL and REDIS_REST_TOKEN are required in production");
    for (const field of [
      "CORS_ORIGIN",
      "OIDC_ISSUER",
      "OIDC_JWKS_URL",
      "REDIS_REST_URL",
      "ERROR_REPORT_URL",
    ] as const) {
      const url = value[field];
      if (url != null && new URL(url).protocol !== "https:")
        issues.push(`${field} must use HTTPS in production`);
    }
    if (
      value.RECEIPT_SIGNING_REQUIRED !== false &&
      (value.RECEIPT_SIGNING_KEY_ID == null || value.RECEIPT_SIGNING_PRIVATE_KEY == null)
    )
      issues.push(
        "Receipt signing keys are required unless RECEIPT_SIGNING_REQUIRED=false is explicit",
      );
  }
  if ((value.RECEIPT_SIGNING_KEY_ID == null) !== (value.RECEIPT_SIGNING_PRIVATE_KEY == null))
    issues.push("Receipt signing requires both private key and key ID");
  if (
    value.RECEIPT_SIGNING_KEY_ID != null &&
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.RECEIPT_SIGNING_KEY_ID)
  )
    issues.push("RECEIPT_SIGNING_KEY_ID is invalid");
  if (value.RECEIPT_SIGNING_PRIVATE_KEY != null) {
    try {
      if (
        createPrivateKey(value.RECEIPT_SIGNING_PRIVATE_KEY.replaceAll("\\n", "\n"))
          .asymmetricKeyType !== "ed25519"
      )
        issues.push("RECEIPT_SIGNING_PRIVATE_KEY must be Ed25519");
    } catch {
      issues.push("RECEIPT_SIGNING_PRIVATE_KEY is invalid");
    }
  }
  const localDemoMode = !isProduction && demoEnabled;
  const githubWebhookEnabled = value.GITHUB_WEBHOOK_ENABLED === true;
  const githubScanLifecycleEnabled = value.GITHUB_SCAN_LIFECYCLE_ENABLED === true;
  const githubMaterializationEnabled = value.GITHUB_MATERIALIZATION_ENABLED === true;
  if (githubWebhookEnabled && value.GITHUB_WEBHOOK_SECRET == null) {
    issues.push("GITHUB_WEBHOOK_SECRET is required when GitHub webhook ingestion is enabled");
  }
  if (githubScanLifecycleEnabled && !githubWebhookEnabled) {
    issues.push("GITHUB_WEBHOOK_ENABLED must be true when GitHub scan lifecycle is enabled");
  }
  if (githubScanLifecycleEnabled && value.GITHUB_SCAN_POLICY_BUNDLE_VERSION == null) {
    issues.push(
      "GITHUB_SCAN_POLICY_BUNDLE_VERSION is required when GitHub scan lifecycle is enabled",
    );
  }
  if (githubScanLifecycleEnabled && !githubMaterializationEnabled)
    issues.push(
      "GITHUB_MATERIALIZATION_ENABLED must be true when GitHub scan lifecycle is enabled",
    );
  if (githubMaterializationEnabled && !githubScanLifecycleEnabled) {
    issues.push(
      "GITHUB_SCAN_LIFECYCLE_ENABLED must be true when GitHub materialization is enabled",
    );
  }
  if (githubMaterializationEnabled) {
    if (value.GITHUB_APP_ID == null || !/^[1-9][0-9]*$/.test(value.GITHUB_APP_ID))
      issues.push("GITHUB_APP_ID is required and must be numeric");
    if (value.GITHUB_PRIVATE_KEY == null) issues.push("GITHUB_PRIVATE_KEY is required");
    else {
      try {
        validateGitHubPrivateKey(value.GITHUB_PRIVATE_KEY);
      } catch {
        issues.push("GITHUB_PRIVATE_KEY is invalid");
      }
    }
  }
  if (value.AUTH_MODE === "oidc" && !localDemoMode) {
    if (value.OIDC_ISSUER == null) issues.push("OIDC_ISSUER is required for oidc authentication");
    if (value.OIDC_AUDIENCE == null) {
      issues.push("OIDC_AUDIENCE is required for oidc authentication");
    }
    if (value.OIDC_JWKS_URL == null) {
      issues.push("OIDC_JWKS_URL is required for oidc authentication");
    }
  }

  if (issues.length > 0)
    throw new Error(`Invalid environment configuration: ${issues.join("; ")}.`);

  return {
    ...value,
    corsOrigin: corsOrigin ?? "http://localhost:5173",
    rateLimitEnabled: value.RATE_LIMIT_ENABLED ?? isProduction,
    githubWebhookEnabled,
    githubScanLifecycleEnabled,
    githubMaterializationEnabled,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}
