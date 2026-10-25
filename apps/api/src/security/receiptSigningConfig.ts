import { createPrivateKey } from "node:crypto";

// No key is required for a reader-only API or explicitly unsigned scans.
// If configured, validate before admitting work and again at the signing boundary.
export function receiptSigningSettings(env: Record<string, string | undefined>) {
  const privateKey = env.RECEIPT_SIGNING_PRIVATE_KEY?.trim() || undefined;
  const keyId = env.RECEIPT_SIGNING_KEY_ID?.trim() || undefined;
  if ((privateKey == null) !== (keyId == null)) {
    throw new Error("Receipt signing requires both private key and key ID.");
  }
  if (privateKey != null && keyId != null) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
      throw new Error("Receipt signing key ID is invalid.");
    }
    try {
      if (createPrivateKey(privateKey).asymmetricKeyType !== "ed25519") {
        throw new Error("Unexpected key algorithm");
      }
    } catch {
      // Never include the supplied key or crypto exception in a public error/log.
      throw new Error("Receipt signing requires a valid Ed25519 private key.");
    }
  }
  return { privateKey, keyId };
}
