import { describe, expect, it } from "vitest";

import { createSecurityReceipt } from "./controlPlane.js";
import {
  generateEd25519KeyPair,
  signSecurityReceipt,
  verifySignedSecurityReceipt,
} from "./signedReceipt.js";

const receipt = createSecurityReceipt({
  id: "receipt-1",
  scanId: "scan-1",
  repository: "synthetic/example",
  branch: "main",
  commitSha: "abc123",
  scannerVersion: "0.1.0",
  policyBundleVersion: "2.0.0",
  findingCounts: { HIGH: 1 },
  decisionCounts: { BLOCK: 1 },
  approvalState: "NOT_REQUIRED",
  evidence: { synthetic: true },
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  completedAt: new Date("2026-01-01T00:01:00.000Z"),
  gateResult: "BLOCK",
});

describe("signed security receipts", () => {
  it("signs and verifies a canonical receipt", () => {
    const key = generateEd25519KeyPair("key-1");
    const signed = signSecurityReceipt(receipt, {
      keyId: key.keyId,
      privateKey: key.privateKeyPem,
    });

    expect(signed.algorithm).toBe("ed25519");
    expect(verifySignedSecurityReceipt(signed, { [key.keyId]: key.publicKeyPem })).toBe(true);
  });

  it("rejects modified payloads and unknown key IDs", () => {
    const key = generateEd25519KeyPair("key-1");
    const signed = signSecurityReceipt(receipt, {
      keyId: key.keyId,
      privateKey: key.privateKeyPem,
    });
    const modified = { ...signed, payload: { ...signed.payload, branch: "release" } };

    expect(verifySignedSecurityReceipt(modified, { [key.keyId]: key.publicKeyPem })).toBe(false);
    expect(verifySignedSecurityReceipt(signed, {})).toBe(false);
  });

  it("supports key rotation through a key ring", () => {
    const oldKey = generateEd25519KeyPair("key-old");
    const newKey = generateEd25519KeyPair("key-new");
    const oldReceipt = signSecurityReceipt(receipt, {
      keyId: oldKey.keyId,
      privateKey: oldKey.privateKeyPem,
    });
    const newReceipt = signSecurityReceipt(receipt, {
      keyId: newKey.keyId,
      privateKey: newKey.privateKeyPem,
    });
    const keyRing = new Map([
      [oldKey.keyId, oldKey.publicKeyPem],
      [newKey.keyId, newKey.publicKeyPem],
    ]);

    expect(verifySignedSecurityReceipt(oldReceipt, keyRing)).toBe(true);
    expect(verifySignedSecurityReceipt(newReceipt, keyRing)).toBe(true);
  });
});
