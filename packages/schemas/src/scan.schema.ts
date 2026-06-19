import { z } from "zod";

import { jsonObjectSchema } from "./json.schema.js";

export const scanStatusSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

export const scanSourceSchema = z.enum(["LOCAL_EXAMPLE", "GITHUB_PULL_REQUEST", "MANUAL"]);

export const scanMetadataSchema = z
  .object({
    source: scanSourceSchema,
    targetPath: z.string().min(1).optional(),
    triggeredBy: z.string().min(1),
    pullRequestId: z.string().min(1).optional(),
    labels: z.array(z.string().min(1)).default([]),
    extra: jsonObjectSchema.default({}),
  })
  .strict();

export const scanSchema = z.object({
  id: z.string().min(1),
  repositoryName: z.string().min(1),
  repositoryUrl: z.string().url().nullable().optional(),
  branch: z.string().min(1),
  commitSha: z.string().min(7).max(64).nullable().optional(),
  status: scanStatusSchema,
  metadata: scanMetadataSchema,
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createScanSchema = scanSchema.omit({
  id: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type ScanStatus = z.infer<typeof scanStatusSchema>;
export type ScanSource = z.infer<typeof scanSourceSchema>;
export type ScanMetadata = z.infer<typeof scanMetadataSchema>;
export type Scan = z.infer<typeof scanSchema>;
export type CreateScan = z.infer<typeof createScanSchema>;
