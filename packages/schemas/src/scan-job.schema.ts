import { z } from "zod";

const boundedString = (max: number) => z.string().trim().min(1).max(max);
const fullCommitSha = z.string().regex(/^[a-f0-9]{40}$/i);

export const scanProviderSchema = z.enum(["LOCAL", "GITHUB"]);
export const scanTriggerSchema = z.enum([
  "MANUAL",
  "PUSH",
  "PULL_REQUEST",
  "INSTALLATION",
  "RETRY",
  "API",
]);

export const scanGitHubLineageSchema = z
  .object({
    installationId: z.number().int().positive(),
    repositoryFullName: boundedString(256),
    deliveryId: boundedString(256).optional(),
    eventName: boundedString(128).optional(),
    action: boundedString(128).optional(),
  })
  .strict();

export const scanOptionsSchema = z
  .object({
    maxFiles: z.number().int().positive().max(100_000).default(10_000),
    maxBytes: z.number().int().positive().max(1_000_000_000).default(100_000_000),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(15 * 60_000)
      .default(120_000),
    ignorePaths: z.array(boundedString(256)).max(64).default([]),
    includeOsv: z.boolean().default(false),
  })
  .strict();

export const createRepositoryScanSchema = z
  .object({
    repositoryId: boundedString(128),
    ref: boundedString(256),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/i)
      .optional(),
    policyBundleVersion: boundedString(128),
    options: scanOptionsSchema.default({}),
  })
  .strict();

export const scanJobPayloadSchema = z
  .object({
    organizationId: boundedString(128),
    // Transitional compatibility field for the current materializer. Writers must
    // derive it server-side and it must equal github.installationId.
    integrationId: boundedString(128).optional(),
    repositoryId: boundedString(128),
    provider: scanProviderSchema,
    repositoryName: boundedString(256),
    repositoryUrl: z.string().url().max(2_048).optional(),
    ref: boundedString(256),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/i)
      .optional(),
    policyBundleVersion: boundedString(128),
    trigger: scanTriggerSchema,
    github: scanGitHubLineageSchema.optional(),
    requester: boundedString(256),
    correlationId: boundedString(128),
    options: scanOptionsSchema.default({}),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.provider === "GITHUB") {
      if (payload.github == null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["github"],
          message: "GitHub provider scans require trusted GitHub lineage",
        });
        return;
      }
      if (payload.commitSha == null || !fullCommitSha.safeParse(payload.commitSha).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["commitSha"],
          message: "GitHub provider scans require an immutable 40-character commit SHA",
        });
      }
      if (payload.github.repositoryFullName !== payload.repositoryName) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["github", "repositoryFullName"],
          message: "GitHub lineage repository must match the registered repository name",
        });
      }
      const expectedIntegrationId = String(payload.github.installationId);
      if (payload.integrationId == null || payload.integrationId !== expectedIntegrationId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["integrationId"],
          message: "GitHub integration identity must match trusted installation lineage",
        });
      }
    } else if (payload.github != null || payload.integrationId != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["github"],
        message: "Non-GitHub scans cannot carry GitHub lineage",
      });
    }

    const webhookTrigger =
      payload.trigger === "PUSH" ||
      payload.trigger === "PULL_REQUEST" ||
      payload.trigger === "INSTALLATION";
    if (webhookTrigger) {
      if (payload.github?.deliveryId == null || payload.github.eventName == null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["github"],
          message: "Webhook-triggered scans require delivery and event provenance",
        });
      }
      const expectedEvent =
        payload.trigger === "PUSH"
          ? "push"
          : payload.trigger === "PULL_REQUEST"
            ? "pull_request"
            : "installation";
      if (payload.github?.eventName != null && payload.github.eventName !== expectedEvent) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["github", "eventName"],
          message: "GitHub webhook event does not match the trusted scan trigger",
        });
      }
    }

    if (
      (payload.trigger === "MANUAL" || payload.trigger === "API") &&
      (payload.github?.deliveryId != null ||
        payload.github?.eventName != null ||
        payload.github?.action != null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["github"],
        message: "Manual/API scans cannot claim webhook delivery provenance",
      });
    }
  });

export const scanJobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);

export type ScanProvider = z.infer<typeof scanProviderSchema>;
export type ScanTrigger = z.infer<typeof scanTriggerSchema>;
export type ScanGitHubLineage = z.infer<typeof scanGitHubLineageSchema>;
export type ScanOptions = z.infer<typeof scanOptionsSchema>;
export type CreateRepositoryScan = z.infer<typeof createRepositoryScanSchema>;
export type ScanJobPayload = z.infer<typeof scanJobPayloadSchema>;
export type ScanJobStatus = z.infer<typeof scanJobStatusSchema>;
