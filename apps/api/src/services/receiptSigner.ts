import {
  signSecurityReceipt,
  type SignedSecurityReceipt,
} from "@agentshield/policy-engine";
import type { SecurityReceipt } from "@agentshield/schemas";

export interface ReceiptSigner {
  sign(receipt: SecurityReceipt): Promise<SignedSecurityReceipt>;
}

export class LocalEd25519ReceiptSigner implements ReceiptSigner {
  constructor(
    private readonly keyId: string,
    private readonly privateKey: string,
  ) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
      throw new Error("Receipt signing key ID contains unsupported characters.");
    }
    if (privateKey.trim().length === 0) {
      throw new Error("Receipt signing private key is required.");
    }
  }

  sign(receipt: SecurityReceipt): Promise<SignedSecurityReceipt> {
    return Promise.resolve(
      signSecurityReceipt(receipt, {
        keyId: this.keyId,
        privateKey: this.privateKey,
      }),
    );
  }
}

export function createConfiguredReceiptSigner(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptSigner | null {
  const keyId = env.RECEIPT_SIGNING_KEY_ID?.trim();
  const privateKey = env.RECEIPT_SIGNING_PRIVATE_KEY?.trim();
  if (
    (keyId == null || keyId.length === 0) !==
    (privateKey == null || privateKey.length === 0)
  ) {
    throw new Error("Receipt signing requires both private key and key ID.");
  }
  if (
    keyId == null ||
    keyId.length === 0 ||
    privateKey == null ||
    privateKey.length === 0
  ) {
    return null;
  }
  return new LocalEd25519ReceiptSigner(keyId, privateKey);
}
