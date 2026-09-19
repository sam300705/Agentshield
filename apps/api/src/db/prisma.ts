import type { PrismaClient as PrismaClientType } from "@prisma/client";

import { PrismaClient } from "./prismaRuntime.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientType;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
