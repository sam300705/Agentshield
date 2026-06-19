import { z } from "zod";

export const approvalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const approvalSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1),
  status: approvalStatusSchema,
  actor: z.string().min(1),
  reason: z.string().min(1).nullable().optional(),
  requestedAt: z.coerce.date(),
  reviewedAt: z.coerce.date().nullable().optional(),
});

export const createApprovalSchema = approvalSchema.omit({
  id: true,
  requestedAt: true,
  reviewedAt: true,
});

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type CreateApproval = z.infer<typeof createApprovalSchema>;
