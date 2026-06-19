import { z } from "zod";

import { jsonObjectSchema } from "./json.schema.js";

export const packageManagerSchema = z.enum(["NPM", "PNPM", "YARN", "UNKNOWN"]);

export const dependencyScopeSchema = z.enum([
  "PRODUCTION",
  "DEVELOPMENT",
  "OPTIONAL",
  "PEER",
  "UNKNOWN",
]);

export const dependencySchema = z.object({
  id: z.string().min(1),
  scanId: z.string().min(1),
  packageName: z.string().min(1),
  version: z.string().min(1),
  packageManager: packageManagerSchema,
  scope: dependencyScopeSchema,
  manifestPath: z.string().min(1),
  purl: z.string().min(1).nullable().optional(),
  license: z.string().min(1).nullable().optional(),
  supplier: z.string().min(1).nullable().optional(),
  metadata: jsonObjectSchema.default({}),
  createdAt: z.coerce.date(),
});

export const sbomSchema = z.object({
  scanId: z.string().min(1),
  generatedAt: z.coerce.date(),
  dependencies: z.array(dependencySchema),
});

export const createDependencySchema = dependencySchema.omit({
  id: true,
  createdAt: true,
});

export type PackageManager = z.infer<typeof packageManagerSchema>;
export type DependencyScope = z.infer<typeof dependencyScopeSchema>;
export type Dependency = z.infer<typeof dependencySchema>;
export type CreateDependency = z.infer<typeof createDependencySchema>;
export type Sbom = z.infer<typeof sbomSchema>;
