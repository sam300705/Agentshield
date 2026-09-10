import { generateEd25519KeyPair, verifySignedSecurityReceipt } from "@agentshield/policy-engine";
import type { SecurityReceipt } from "@agentshield/schemas";
import { describe, expect, it } from "vitest";

import { createConfiguredReceiptSigner } from "./receiptSigner.js";

const receipt: SecurityReceipt = {
  schemaVersion: "1.0",
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
  evidenceDigest: "sha256:placeholder",
  gateResult: "ALLOW",
  startedAt: new Date("2026-09-11T00:00:00Z"),
  completedAt: new Date("2026-09-11T00:00:01Z"),
  receiptHash: "sha256:placeholder",
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
    expect(signer).not.toBeNull();
    const signed = await signer!.sign(receipt);
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
