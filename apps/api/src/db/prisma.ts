import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [], // Database errors can contain parameters and credentials; log only safe API envelopes.
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
