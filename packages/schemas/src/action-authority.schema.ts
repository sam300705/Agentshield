import { z } from "zod";
import { sanitizeText } from "./evidenceRedaction.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const authorityDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const key = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{8,128}$/)
  .refine((value) => sanitizeText(value) === value, "Credential-like keys are not accepted.");
// v1 accepts one spelling only: no decoding, Unicode, dot segments, @ or backslash.
export const authorityRefSchema = z
  .string()
  .max(160)
  .regex(
    /^refs\/heads\/agentshield\/[A-Za-z0-9](?:[A-Za-z0-9_-]|\/(?!\/))*[A-Za-z0-9_-]$|^refs\/heads\/agentshield\/[A-Za-z0-9]$/,
  )
  .refine((value) => sanitizeText(value) === value, "Credential-like refs are not accepted.");
export const actionIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalizationVersion: z.literal(1),
    actionType: z.literal("GITHUB_CREATE_REF"),
    sessionId: identifier,
    repositoryId: identifier,
    evidenceScanId: identifier,
    commitSha: z
      .string()
      .regex(/^[a-fA-F0-9]{40}$/)
      .transform((value) => value.toLowerCase()),
    parameters: z.object({ ref: authorityRefSchema, targetMustBeAbsent: z.literal(true) }).strict(),
    idempotencyKey: key,
  })
  .strict();
export const authorityPolicyModeSchema = z.enum(["DENY", "REQUIRE_APPROVAL"]);
export const authorityPolicyUpdateSchema = z
  .object({
    expectedRevision: z.string().uuid().nullable(),
    mode: authorityPolicyModeSchema,
  })
  .strict();
export const authorityReviewSchema = z
  .object({
    contextDigest: authorityDigestSchema,
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export const authorityRevokeSchema = z.object({ contextDigest: authorityDigestSchema }).strict();
export const authorityAdmissionSchema = z
  .object({
    authorizationId: identifier,
    contextDigest: authorityDigestSchema,
    operationKey: key,
  })
  .strict();
export const authorityContextSchema = z
  .object({
    canonicalizationVersion: z.literal(1),
    schemaVersion: z.literal(1),
    normalizationVersion: z.literal(1),
    actionType: z.literal("GITHUB_CREATE_REF"),
    provider: z.literal("GITHUB"),
    organizationId: z.string().min(1).max(128),
    actor: z.string().min(1).max(256),
    sessionId: identifier,
    repositoryId: identifier,
    providerRepositoryId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    providerInstallationId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    parameters: actionIntentSchema.shape.parameters,
    evidenceScanId: identifier,
    evidenceCompletedAt: z.string().datetime(),
    evidenceMaxAgeSeconds: z.literal(1800),
    evidenceVerification: z.literal("APPLICATION_HASH_ONLY"),
    evidencePolicyVersion: z.string().min(1).max(128),
    policyDecision: z
      .object({
        decision: z.enum(["DENY", "REQUIRE_APPROVAL"]),
        ruleId: z.string().min(1).max(128),
        reason: z.string().min(1).max(1000),
      })
      .strict(),
    evidenceReceiptHash: authorityDigestSchema,
    policyRevision: z.string().uuid(),
    policyEngineVersion: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();
export const authorityOperationSchema = z
  .object({
    schemaVersion: z.literal(1),
    admittedAt: z.coerce.date(),
    cancelledAt: z.coerce.date().nullable(),
    id: identifier,
    authorizationId: identifier,
    contextDigest: authorityDigestSchema,
    state: z.enum(["HELD", "CANCELLED"]),
    dispatchEnabled: z.literal(false),
    observedOutcome: z.literal("NOT_DISPATCHED"),
  })
  .strict();
export type ActionIntent = z.infer<typeof actionIntentSchema>;
export type AuthorityContext = z.infer<typeof authorityContextSchema>;
export type AuthorityAdmission = z.infer<typeof authorityAdmissionSchema>;

export const authorityDecisionRecordSchema = z
  .object({
    id: identifier,
    policyRevision: z.string().uuid(),
    policyEngineVersion: z.string().min(1).max(128),
    matchedRuleIds: z.array(z.string().min(1).max(128)).min(1).max(1),
    decision: z.enum(["DENY", "REQUIRE_APPROVAL"]),
    reason: z.string().min(1).max(1000),
    contextDigest: authorityDigestSchema,
    evidenceStatus: z.literal("COMPLETE"),
    expiresAt: z.coerce.date(),
    reviewerPermission: z.literal("approval:review"),
    independentOfActor: z.literal(true),
  })
  .strict();
export const authorityAuthorizationSchema = z
  .object({
    createdAt: z.coerce.date(),
    id: identifier,
    decisionId: identifier,
    actor: z.string().min(1).max(256),
    context: authorityContextSchema,
    contextDigest: authorityDigestSchema,
    decision: z.enum(["DENY", "REQUIRE_APPROVAL"]),
    decisionRecord: authorityDecisionRecordSchema,
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "REVOKED", "CONSUMED"]),
    expired: z.boolean(),
    expiresAt: z.coerce.date(),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.coerce.date().nullable(),
    reason: z.string().max(1000).nullable(),
    revokedAt: z.coerce.date().nullable(),
    dispatchEnabled: z.literal(false),
    observedOutcome: z.literal("NOT_DISPATCHED"),
  })
  .strict();
