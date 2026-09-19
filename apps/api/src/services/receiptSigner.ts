import {
  signSecurityReceipt,
  verifySignedSecurityReceipt,
  type SignedSecurityReceipt,
} from "@agentshield/policy-engine";
import type { SecurityReceipt } from "@agentshield/schemas";

export interface ReceiptSigner {
  sign(receipt: SecurityReceipt): Promise<SignedSecurityReceipt>;
}

export interface ReceiptVerifier {
  verify(receipt: SignedSecurityReceipt): boolean;
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

export class PublicKeyRingReceiptVerifier implements ReceiptVerifier {
  constructor(private readonly publicKeys: Readonly<Record<string, string>>) {}

  verify(receipt: SignedSecurityReceipt): boolean {
    return verifySignedSecurityReceipt(receipt, this.publicKeys);
  }
}

function parsePublicKeyRing(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Receipt verification public key ring must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    throw new Error("Receipt verification public key ring must be a JSON object.");
  }

  const publicKeys: Record<string, string> = {};
  for (const [keyId, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
      throw new Error("Receipt verification key ID contains unsupported characters.");
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Receipt verification public keys must be non-empty PEM strings.");
    }
    publicKeys[keyId] = value.trim();
  }
  if (Object.keys(publicKeys).length === 0) {
    throw new Error("Receipt verification public key ring must contain at least one key.");
  }
  return publicKeys;
}

export function createConfiguredReceiptSigner(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptSigner | null {
  const keyId = env.RECEIPT_SIGNING_KEY_ID?.trim();
  const privateKey = env.RECEIPT_SIGNING_PRIVATE_KEY?.trim();
  if ((keyId == null || keyId.length === 0) !== (privateKey == null || privateKey.length === 0)) {
    throw new Error("Receipt signing requires both private key and key ID.");
  }
  if (keyId == null || keyId.length === 0 || privateKey == null || privateKey.length === 0) {
    return null;
  }
  return new LocalEd25519ReceiptSigner(keyId, privateKey);
}

export function createConfiguredReceiptVerifier(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptVerifier | null {
  const raw = env.RECEIPT_SIGNING_PUBLIC_KEYS_JSON?.trim();
  if (raw == null || raw.length === 0) return null;
  return new PublicKeyRingReceiptVerifier(parsePublicKeyRing(raw));
}
