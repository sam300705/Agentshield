import type { PrismaClient } from "@prisma/client";

export async function clearSeedScans(client: PrismaClient): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.securityReceipt.deleteMany();
    await tx.policySimulation.deleteMany({ where: { sourceScanId: { not: null } } });
    await tx.auditEvent.deleteMany();
    await tx.policyDecision.deleteMany();
    await tx.remediation.deleteMany();
    await tx.approval.deleteMany();
    await tx.dependency.deleteMany();
    await tx.finding.deleteMany();
    await tx.scan.deleteMany();
  });
}
