import type { PrismaClient } from "@prisma/client";

// Only seed-labelled demo scans may be removed. Never erase unrelated history
// from a developer's localhost database.
export async function clearSeedScans(client: PrismaClient): Promise<void> {
  const scanWhere = {
    organizationId: "demo-organization",
    metadata: { path: ["labels"], array_contains: ["phase-2-seed"] },
  };
  await client.$transaction(async (tx) => {
    await tx.securityReceipt.deleteMany({ where: { scan: scanWhere } });
    await tx.policySimulation.deleteMany({ where: { sourceScan: scanWhere } });
    await tx.auditEvent.deleteMany({ where: { scan: scanWhere } });
    await tx.policyDecision.deleteMany({ where: { finding: { scan: scanWhere } } });
    await tx.remediation.deleteMany({ where: { finding: { scan: scanWhere } } });
    await tx.approval.deleteMany({ where: { finding: { scan: scanWhere } } });
    await tx.dependency.deleteMany({ where: { scan: scanWhere } });
    await tx.finding.deleteMany({ where: { scan: scanWhere } });
    await tx.scan.deleteMany({ where: scanWhere });
  });
}
