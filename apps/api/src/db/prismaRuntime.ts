import { createRequire } from "node:module";

// This is the single intentional CJS/ESM bridge for Prisma's generated client.
// A module-namespace type is required here because createRequire() loads the
// runtime CommonJS module while the rest of the API remains native ESM.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PrismaClientModule = typeof import("@prisma/client");

const require = createRequire(import.meta.url);
const prismaClient = require("@prisma/client") as PrismaClientModule;

export const PrismaClient = prismaClient.PrismaClient;
export const Prisma = prismaClient.Prisma;
export const ApprovalStatus = prismaClient.ApprovalStatus;
export const AuditAction = prismaClient.AuditAction;
export const PolicyDecisionType = prismaClient.PolicyDecisionType;
export const ScanStatus = prismaClient.ScanStatus;
