import {
  createPrivateKey,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

import { securityReceiptSchema, type SecurityReceipt } from "@agentshield/schemas";

import { canonicalJson } from "./controlPlane.js";

export const SIGNED_RECEIPT_FORMAT = "agentshield-signed-receipt" as const;
export const SIGNED_RECEIPT_ALGORITHM = "ed25519" as const;

export interface Ed25519KeyPair {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface ReceiptSigningKey {
  keyId: string;
  privateKey: KeyObject | string;
}

export interface SignedSecurityReceipt {
  format: typeof SIGNED_RECEIPT_FORMAT;
  version: 1;
  algorithm: typeof SIGNED_RECEIPT_ALGORITHM;
  keyId: string;
  payload: SecurityReceipt;
  signature: string;
}

function asPrivateKey(key: KeyObject | string): KeyObject {
  return typeof key === "string" ? createPrivateKey(key) : key;
}

function asPublicKey(key: KeyObject | string): KeyObject {
  return typeof key === "string" ? createPublicKey(key) : key;
}

export function generateEd25519KeyPair(keyId: string): Ed25519KeyPair {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
    throw new Error("Receipt key ID must contain only safe identifier characters.");
  }
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return { keyId, privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

export function canonicalReceiptPayload(receipt: SecurityReceipt): string {
  return canonicalJson(securityReceiptSchema.parse(receipt));
}

export function verifyReceiptHash(receipt: SecurityReceipt): boolean {
  const parsed = securityReceiptSchema.parse(receipt);
  const { receiptHash, ...payload } = parsed;
  return receiptHash === createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function signSecurityReceipt(
  receipt: SecurityReceipt,
  signingKey: ReceiptSigningKey,
): SignedSecurityReceipt {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(signingKey.keyId))
    throw new Error("Receipt key ID must contain only safe identifier characters.");
  const payload = securityReceiptSchema.parse(receipt);
  if (!verifyReceiptHash(payload)) throw new Error("Receipt hash does not match its payload.");
  const signature = sign(
    null,
    Buffer.from(canonicalReceiptPayload(payload), "utf8"),
    asPrivateKey(signingKey.privateKey),
  ).toString("base64url");
  return {
    format: SIGNED_RECEIPT_FORMAT,
    version: 1,
    algorithm: SIGNED_RECEIPT_ALGORITHM,
    keyId: signingKey.keyId,
    payload,
    signature,
  };
}

type PublicKeyRing = ReadonlyMap<string, KeyObject | string> | Record<string, KeyObject | string>;

function isPublicKeyMap(value: PublicKeyRing): value is ReadonlyMap<string, KeyObject | string> {
  return (
    typeof value === "object" && value !== null && "get" in value && typeof value.get === "function"
  );
}

export function verifySignedSecurityReceipt(
  signedReceipt: SignedSecurityReceipt,
  publicKeys: PublicKeyRing,
): boolean {
  if (
    signedReceipt.format !== SIGNED_RECEIPT_FORMAT ||
    signedReceipt.version !== 1 ||
    signedReceipt.algorithm !== SIGNED_RECEIPT_ALGORITHM ||
    typeof signedReceipt.keyId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(signedReceipt.keyId)
  ) {
    return false;
  }
  let publicKey: KeyObject | string | undefined;
  if (isPublicKeyMap(publicKeys)) {
    publicKey = publicKeys.get(signedReceipt.keyId);
  } else {
    publicKey = publicKeys[signedReceipt.keyId];
  }
  if (publicKey == null) return false;
  try {
    const payload = securityReceiptSchema.parse(signedReceipt.payload);
    if (!verifyReceiptHash(payload)) return false;
    return verify(
      null,
      Buffer.from(canonicalReceiptPayload(payload), "utf8"),
      asPublicKey(publicKey),
      Buffer.from(signedReceipt.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
