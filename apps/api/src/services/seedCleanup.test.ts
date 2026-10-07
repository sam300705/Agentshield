import type { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { clearSeedScans } from "./seedCleanup.js";
it("can reset scans with restrictive receipts and simulations inside one transaction", async () => {
  let receipts = 1;
  let simulations = 1;
  const tx = {
    securityReceipt: {
      deleteMany: vi.fn(() => {
        receipts = 0;
        return Promise.resolve();
      }),
    },
    policySimulation: {
      deleteMany: vi.fn(() => {
        simulations = 0;
        return Promise.resolve();
      }),
    },
    scan: {
      deleteMany: vi.fn(() => {
        if (receipts || simulations) return Promise.reject(new Error("Foreign key restriction"));
        return Promise.resolve();
      }),
    },
    ...Object.fromEntries(
      ["auditEvent", "policyDecision", "remediation", "approval", "dependency", "finding"].map(
        (key) => [key, { deleteMany: vi.fn() }],
      ),
    ),
  };
  const transaction = vi.fn((callback: (client: typeof tx) => Promise<void>) => callback(tx));
  await clearSeedScans({ $transaction: transaction } as unknown as PrismaClient);
  expect(tx.scan.deleteMany).toHaveBeenCalledOnce();
  expect(transaction).toHaveBeenCalledOnce();
});
