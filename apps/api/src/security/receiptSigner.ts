import { signSecurityReceipt, type SignedSecurityReceipt } from "@agentshield/policy-engine";
import type { SecurityReceipt } from "@agentshield/schemas";

/** Implementations must return the existing Ed25519 receipt format. The scanner never owns key generation. */
export interface ReceiptSigner {
  readonly keyId: string;
  readonly algorithm: "ed25519";
  sign(receipt: SecurityReceipt): Promise<SignedSecurityReceipt>;
}

/** Platform-secret custody, not KMS/HSM custody. The key stays in the worker process. */
export class PlatformSecretReceiptSigner implements ReceiptSigner {
  readonly algorithm = "ed25519" as const;
  constructor(
    readonly keyId: string,
    private readonly privateKey: string,
  ) {}
  sign(receipt: SecurityReceipt): Promise<SignedSecurityReceipt> {
    return Promise.resolve(
      signSecurityReceipt(receipt, {
        keyId: this.keyId,
        privateKey: this.privateKey.replaceAll("\\n", "\n"),
      }),
    );
  }
}

export function receiptSignerFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptSigner | null {
  const key = env.RECEIPT_SIGNING_PRIVATE_KEY?.trim();
  const id = env.RECEIPT_SIGNING_KEY_ID?.trim();
  const required =
    env.RECEIPT_SIGNING_REQUIRED === "true" ||
    (env.NODE_ENV === "production" && env.RECEIPT_SIGNING_REQUIRED !== "false");
  if ((key == null || key === "") !== (id == null || id === "") || (required && (!key || !id)))
    throw new Error("RECEIPT_SIGNER_UNAVAILABLE");
  return key && id ? new PlatformSecretReceiptSigner(id, key) : null;
}
