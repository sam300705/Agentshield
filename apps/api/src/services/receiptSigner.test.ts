import { generateEd25519KeyPair, verifySignedSecurityReceipt } from "@agentshield/policy-engine";
import type { SecurityReceipt } from "@agentshield/schemas";
import { describe, expect, it } from "vitest";

import { createConfiguredReceiptSigner, createConfiguredReceiptVerifier } from "./receiptSigner.js";

const VALID_SHA256 = "a".repeat(64);

const receipt: SecurityReceipt = {
  id: "receipt:test",
  scanId: "scan-test",
  repository: "acme/project",
  branch: "main",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  scannerVersion: "agentshield-scanner@0.2.0",
  policyBundleVersion: "production@1",
  findingCounts: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
  decisionCounts: { ALLOW: 0, WARN: 0, REQUIRE_APPROVAL: 0, BLOCK: 0 },
  approvalState: "NONE",
  evidenceDigest: VALID_SHA256,
  gateResult: "ALLOW",
  startedAt: new Date("2026-09-11T00:00:00Z"),
  completedAt: new Date("2026-09-11T00:00:01Z"),
  receiptHash: VALID_SHA256,
};

describe("receipt signer configuration", () => {
  it("keeps signing disabled when no custody is configured", () => {
    expect(createConfiguredReceiptSigner({})).toBeNull();
  });

  it("fails closed on partial signing configuration", () => {
    expect(() => createConfiguredReceiptSigner({ RECEIPT_SIGNING_KEY_ID: "primary" })).toThrow(
      "requires both private key and key ID",
    );
  });

  it("signs through the adapter and verifies with the matching public key", async () => {
    const keys = generateEd25519KeyPair("primary");
    const signer = createConfiguredReceiptSigner({
      RECEIPT_SIGNING_KEY_ID: keys.keyId,
      RECEIPT_SIGNING_PRIVATE_KEY: keys.privateKeyPem,
    });
    if (signer == null) throw new Error("Expected configured receipt signer.");
    const signed = await signer.sign(receipt);
    expect(verifySignedSecurityReceipt(signed, { [keys.keyId]: keys.publicKeyPem })).toBe(true);
  });

  it("rejects unsafe key identifiers before signing", () => {
    const keys = generateEd25519KeyPair("safe");
    expect(() =>
      createConfiguredReceiptSigner({
        RECEIPT_SIGNING_KEY_ID: "unsafe id",
        RECEIPT_SIGNING_PRIVATE_KEY: keys.privateKeyPem,
      }),
    ).toThrow("unsupported characters");
  });
});

describe("receipt verifier configuration", () => {
  it("keeps verification disabled when no public key ring is configured", () => {
    expect(createConfiguredReceiptVerifier({})).toBeNull();
  });

  it("accepts previous and current keys during rotation", async () => {
    const previous = generateEd25519KeyPair("previous");
    const current = generateEd25519KeyPair("current");
    const previousSigner = createConfiguredReceiptSigner({
      RECEIPT_SIGNING_KEY_ID: previous.keyId,
      RECEIPT_SIGNING_PRIVATE_KEY: previous.privateKeyPem,
    });
    const currentSigner = createConfiguredReceiptSigner({
      RECEIPT_SIGNING_KEY_ID: current.keyId,
      RECEIPT_SIGNING_PRIVATE_KEY: current.privateKeyPem,
    });
    if (previousSigner == null || currentSigner == null) {
      throw new Error("Expected configured receipt signers.");
    }

    const verifier = createConfiguredReceiptVerifier({
      RECEIPT_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify({
        [previous.keyId]: previous.publicKeyPem,
        [current.keyId]: current.publicKeyPem,
      }),
    });
    if (verifier == null) throw new Error("Expected configured receipt verifier.");

    expect(verifier.verify(await previousSigner.sign(receipt))).toBe(true);
    expect(verifier.verify(await currentSigner.sign(receipt))).toBe(true);
  });

  it("rejects unknown keys and tampered receipts", async () => {
    const keys = generateEd25519KeyPair("current");
    const signer = createConfiguredReceiptSigner({
      RECEIPT_SIGNING_KEY_ID: keys.keyId,
      RECEIPT_SIGNING_PRIVATE_KEY: keys.privateKeyPem,
    });
    if (signer == null) throw new Error("Expected configured receipt signer.");
    const signed = await signer.sign(receipt);

    const other = generateEd25519KeyPair("other");
    const wrongVerifier = createConfiguredReceiptVerifier({
      RECEIPT_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify({ [other.keyId]: other.publicKeyPem }),
    });
    if (wrongVerifier == null) throw new Error("Expected configured receipt verifier.");
    expect(wrongVerifier.verify(signed)).toBe(false);

    const verifier = createConfiguredReceiptVerifier({
      RECEIPT_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify({ [keys.keyId]: keys.publicKeyPem }),
    });
    if (verifier == null) throw new Error("Expected configured receipt verifier.");
    const tampered = {
      ...signed,
      payload: { ...signed.payload, repository: "attacker/repository" },
    };
    expect(verifier.verify(tampered)).toBe(false);
  });

  it("fails closed on malformed public key ring configuration", () => {
    expect(() =>
      createConfiguredReceiptVerifier({ RECEIPT_SIGNING_PUBLIC_KEYS_JSON: "[]" }),
    ).toThrow("must be a JSON object");
    expect(() =>
      createConfiguredReceiptVerifier({
        RECEIPT_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify({ "unsafe id": "pem" }),
      }),
    ).toThrow("unsupported characters");
    expect(() =>
      createConfiguredReceiptVerifier({ RECEIPT_SIGNING_PUBLIC_KEYS_JSON: "{}" }),
    ).toThrow("at least one key");
  });
});
