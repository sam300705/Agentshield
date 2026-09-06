import { readFile } from "node:fs/promises";

import {
  verifySignedSecurityReceipt,
  type SignedSecurityReceipt,
} from "@agentshield/policy-engine";

function usage(): never {
  console.error("Usage: pnpm receipt:verify -- --receipt <file.json> --public-key <file.pem>");
  process.exit(2);
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value == null || value.startsWith("--")) usage();
  return value;
}

async function main(): Promise<void> {
  const receiptPath = argument("--receipt");
  const publicKeyPath = argument("--public-key");
  const signedReceipt = JSON.parse(await readFile(receiptPath, "utf8")) as SignedSecurityReceipt;
  const publicKey = await readFile(publicKeyPath, "utf8");
  const valid = verifySignedSecurityReceipt(signedReceipt, {
    [signedReceipt.keyId]: publicKey,
  });

  if (!valid) {
    console.error("Receipt signature verification failed.");
    process.exitCode = 1;
    return;
  }
  console.warn(`Receipt signature verified: keyId=${signedReceipt.keyId}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Receipt verification failed.");
  process.exitCode = 1;
});
