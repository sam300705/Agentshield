import { createRequire } from "node:module";

type PrismaClientModule = {
  PrismaClient: typeof import("@prisma/client").PrismaClient;
  Prisma: typeof import("@prisma/client").Prisma;
  ApprovalStatus: typeof import("@prisma/client").ApprovalStatus;
  AuditAction: typeof import("@prisma/client").AuditAction;
  PolicyDecisionType: typeof import("@prisma/client").PolicyDecisionType;
  ScanStatus: typeof import("@prisma/client").ScanStatus;
};

const require = createRequire(import.meta.url);
const prismaClient = require("@prisma/client") as PrismaClientModule;

export const PrismaClient = prismaClient.PrismaClient;
export const Prisma = prismaClient.Prisma;
export const ApprovalStatus = prismaClient.ApprovalStatus;
export const AuditAction = prismaClient.AuditAction;
export const PolicyDecisionType = prismaClient.PolicyDecisionType;
export const ScanStatus = prismaClient.ScanStatus;
