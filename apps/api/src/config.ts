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
  GITHUB_APP_ID: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_WEBHOOK_SECRET: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  GITHUB_WEBHOOK_ENABLED: booleanFromEnv.optional(),
});

export type RuntimeConfig = z.infer<typeof baseSchema> & {
  corsOrigin: string;
  rateLimitEnabled: boolean;
  githubWebhookEnabled: boolean;
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
  const localDemoMode = !isProduction && demoEnabled;
  const githubWebhookEnabled = value.GITHUB_WEBHOOK_ENABLED === true;
  if (githubWebhookEnabled && value.GITHUB_WEBHOOK_SECRET == null) {
    issues.push("GITHUB_WEBHOOK_SECRET is required when GitHub webhook ingestion is enabled");
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
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}
