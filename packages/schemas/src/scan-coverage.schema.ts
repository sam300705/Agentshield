import { z } from "zod";

export const scanCoverageSchema = z
  .object({
    status: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
    scope: z.literal(
      "Supported static checks within the observed scope; not proof of safety or complete event capture.",
    ),
    enumeratedFiles: z.number().int().nonnegative(),
    inspectedFiles: z.number().int().nonnegative(),
    unsupportedFiles: z.number().int().nonnegative(),
    excludedEntries: z.number().int().nonnegative(),
  })
  .strict();
export type ScanCoverage = z.infer<typeof scanCoverageSchema>;
