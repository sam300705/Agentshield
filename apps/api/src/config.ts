import { z } from "zod";

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

function normalizePrivateKey(value: string): string {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

const PRIVATE_KEY_PEM_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

function isPemPrivateKey(value: string): boolean {
  return PRIVATE_KEY_PEM_PATTERN.test(value);
}

function getGitHubPrivateKeyIssues(privateKey: string | undefined): string[] {
  if (privateKey == null) {
    return ["GITHUB_PRIVATE_KEY is required when GitHub scan lifecycle is enabled"];
  }
  if (!isPemPrivateKey(privateKey)) {
    return [
      "GITHUB_PRIVATE_KEY must be a PEM-encoded private key (with BEGIN/END PRIVATE KEY markers) when GitHub scan lifecycle is enabled",
    ];
  }
  return [];
}
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
  RATE_LIMIT_ENABLED: booleanFromEnv.optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100_000).default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(86_400_000).default(60_000),
  RATE_LIMIT_BACKEND: z.enum(["memory", "redis-rest"]).default("memory"),
  RATE_LIMIT_REDIS_REST_URL: optionalUrl,
  RATE_LIMIT_REDIS_REST_TOKEN: optionalString,
  RATE_LIMIT_REDIS_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(2_000),
  GITHUB_APP_ID: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_WEBHOOK_SECRET: optionalString,
  // Normalized at parse time so consumers always see real newlines whether the
  // operator mounted a PEM file or pasted the key with escaped "\n" sequences.
  GITHUB_PRIVATE_KEY: z.preprocess(
    blankToUndefined,
    z.string().min(1).transform(normalizePrivateKey).optional(),
  ),
  GITHUB_WEBHOOK_ENABLED: booleanFromEnv.optional(),
  GITHUB_SCAN_LIFECYCLE_ENABLED: booleanFromEnv.optional(),
  GITHUB_MATERIALIZATION_ENABLED: booleanFromEnv.optional(),
  GITHUB_CHECKS_ENABLED: booleanFromEnv.optional(),
  GITHUB_SCAN_POLICY_BUNDLE_VERSION: optionalString,
  // Canonical public dashboard origin. Only used to build links advertised in
  // GitHub Checks output; when unset, Checks carry no dashboard links.
  DASHBOARD_PUBLIC_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
});

export type RuntimeConfig = z.infer<typeof baseSchema> & {
  corsOrigin: string;
  rateLimitEnabled: boolean;
  githubWebhookEnabled: boolean;
  githubScanLifecycleEnabled: boolean;
  githubMaterializationEnabled: boolean;
  githubChecksEnabled: boolean;
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
  const rateLimitEnabled = value.RATE_LIMIT_ENABLED ?? isProduction;

  if (value.DATABASE_URL == null) issues.push("DATABASE_URL is required");
  if (corsOrigin == null) issues.push("CORS_ORIGIN is required");
  if (isProduction && value.AUTH_MODE !== "oidc") {
    issues.push("AUTH_MODE must be oidc in production");
  }
  if (isProduction && demoEnabled) {
    issues.push("DEMO_AUTH_ENABLED must be false or unset in production");
  }
  if (isProduction && !rateLimitEnabled) {
    issues.push("RATE_LIMIT_ENABLED cannot be disabled in production");
  }
  if (isProduction && rateLimitEnabled && value.RATE_LIMIT_BACKEND !== "redis-rest") {
    issues.push("RATE_LIMIT_BACKEND must be redis-rest in production");
  }
  if (rateLimitEnabled && value.RATE_LIMIT_BACKEND === "redis-rest") {
    if (value.RATE_LIMIT_REDIS_REST_URL == null) {
      issues.push("RATE_LIMIT_REDIS_REST_URL is required for redis-rest rate limiting");
    } else if (
      isProduction &&
      new URL(value.RATE_LIMIT_REDIS_REST_URL).protocol.toLowerCase() !== "https:"
    ) {
      issues.push("RATE_LIMIT_REDIS_REST_URL must use HTTPS in production");
    }
    if (value.RATE_LIMIT_REDIS_REST_TOKEN == null) {
      issues.push("RATE_LIMIT_REDIS_REST_TOKEN is required for redis-rest rate limiting");
    }
  }

  const localDemoMode = !isProduction && demoEnabled;
  const githubWebhookEnabled = value.GITHUB_WEBHOOK_ENABLED === true;
  const githubScanLifecycleEnabled = value.GITHUB_SCAN_LIFECYCLE_ENABLED === true;
  const githubMaterializationEnabled = value.GITHUB_MATERIALIZATION_ENABLED === true;
  const githubChecksEnabled = value.GITHUB_CHECKS_ENABLED === true;
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
  if (githubMaterializationEnabled && !githubScanLifecycleEnabled) {
    issues.push(
      "GITHUB_SCAN_LIFECYCLE_ENABLED must be true when GitHub materialization is enabled",
    );
  }
  if (githubScanLifecycleEnabled) {
    if (value.GITHUB_APP_ID == null) {
      issues.push("GITHUB_APP_ID is required when GitHub scan lifecycle is enabled");
    } else if (!/^\d+$/.test(value.GITHUB_APP_ID)) {
      issues.push(
        "GITHUB_APP_ID must be a numeric GitHub App ID when GitHub scan lifecycle is enabled",
      );
    }
    issues.push(...getGitHubPrivateKeyIssues(value.GITHUB_PRIVATE_KEY));
  }
  if (githubChecksEnabled && !githubScanLifecycleEnabled) {
    issues.push(
      "GITHUB_SCAN_LIFECYCLE_ENABLED must be true when GitHub Checks publishing is enabled",
    );
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
    rateLimitEnabled,
    githubWebhookEnabled,
    githubScanLifecycleEnabled,
    githubMaterializationEnabled,
    githubChecksEnabled,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}
