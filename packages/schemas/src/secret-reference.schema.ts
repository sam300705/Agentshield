import { z } from "zod";

export const secretProviderSchema = z.enum([
  "ENVIRONMENT",
  "AZURE_KEY_VAULT",
  "AWS_SECRETS_MANAGER",
  "GCP_SECRET_MANAGER",
]);

export const secretReferenceSchema = z
  .object({
    provider: secretProviderSchema,
    secretRef: z.string().trim().min(1).max(512),
    keyId: z.string().trim().min(1).max(256).optional(),
    version: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type SecretProvider = z.infer<typeof secretProviderSchema>;
export type SecretReference = z.infer<typeof secretReferenceSchema>;
