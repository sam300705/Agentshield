import type { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { clearSeedScans } from "./seedCleanup.js";

it("deletes only marker-labelled demo scans while preserving unrelated tenant history", async () => {
  const tx = Object.fromEntries(
    ["securityReceipt", "policySimulation", "auditEvent", "policyDecision", "remediation",
      "approval", "dependency", "finding", "scan"].map((key) => [
      key,
      { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ]),
  ) as Record<string, { deleteMany: ReturnType<typeof vi.fn> }>;
  const transaction = vi.fn((callback: (client: typeof tx) => Promise<void>) => callback(tx));
  await clearSeedScans({ $transaction: transaction } as unknown as PrismaClient);
  const marker = {
    organizationId: "demo-organization",
    metadata: { path: ["labels"], array_contains: ["phase-2-seed"] },
  };
  expect(transaction).toHaveBeenCalledOnce();
  expect(tx.scan?.deleteMany).toHaveBeenCalledWith({ where: marker });
  expect(tx.securityReceipt?.deleteMany).toHaveBeenCalledWith({ where: { scan: marker } });
  expect(tx.policySimulation?.deleteMany).toHaveBeenCalledWith({
    where: { sourceScan: marker },
  });
  expect(tx.auditEvent?.deleteMany).toHaveBeenCalledWith({ where: { scan: marker } });
  for (const name of ["policyDecision", "remediation", "approval"]) {
    expect(tx[name]?.deleteMany).toHaveBeenCalledWith({
      where: { finding: { scan: marker } },
    });
  }
  for (const name of ["dependency", "finding"]) {
    expect(tx[name]?.deleteMany).toHaveBeenCalledWith({ where: { scan: marker } });
  }
});
