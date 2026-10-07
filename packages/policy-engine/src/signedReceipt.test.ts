import { sign as cryptoSign, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createSecurityReceipt } from "./controlPlane.js";
import {
  generateEd25519KeyPair,
  signSecurityReceipt,
  verifySignedSecurityReceipt,
  canonicalReceiptPayload,
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
  it("rejects a false internal hash even when a trusted key signs the payload", () => {
    const key = generateEd25519KeyPair("key-1");
    const bad = { ...receipt, receiptHash: "0".repeat(64) };
    expect(() =>
      signSecurityReceipt(bad, { keyId: key.keyId, privateKey: key.privateKeyPem }),
    ).toThrow("Receipt hash");
    const signed = signSecurityReceipt(receipt, {
      keyId: key.keyId,
      privateKey: key.privateKeyPem,
    });
    const signature = cryptoSign(
      null,
      Buffer.from(canonicalReceiptPayload(bad)),
      createPrivateKey(key.privateKeyPem),
    ).toString("base64url");
    expect(
      verifySignedSecurityReceipt(
        { ...signed, payload: bad, signature },
        { [key.keyId]: key.publicKeyPem },
      ),
    ).toBe(false);
  });
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

it.each(["", "production key", "x".repeat(129), "key/unsafe"])(
  "rejects signing key ID %s before creating an unverifiable envelope",
  (keyId) => {
    const key = generateEd25519KeyPair("valid");
    expect(() => signSecurityReceipt(receipt, { keyId, privateKey: key.privateKeyPem })).toThrow(
      "key ID",
    );
  },
);
it("verifies the longest accepted safe signing identifier", () => {
  const keyId = "x".repeat(128);
  const key = generateEd25519KeyPair(keyId);
  expect(
    verifySignedSecurityReceipt(
      signSecurityReceipt(receipt, { keyId, privateKey: key.privateKeyPem }),
      { [keyId]: key.publicKeyPem },
    ),
  ).toBe(true);
});
