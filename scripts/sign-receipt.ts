import { readFile } from "node:fs/promises";

import { signSecurityReceipt } from "@agentshield/policy-engine";
import { securityReceiptSchema } from "@agentshield/schemas";

function usage(): never {
  console.error(
    "Usage: pnpm receipt:sign -- --receipt <file.json> --private-key <file.pem> --key-id <id>",
  );
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
  const privateKeyPath = argument("--private-key");
  const keyId = argument("--key-id");
  const parsed: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
  const receipt = securityReceiptSchema.parse(parsed);
  const privateKey = await readFile(privateKeyPath, "utf8");
  const signed = signSecurityReceipt(receipt, { keyId, privateKey });
  process.stdout.write(`${JSON.stringify(signed, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Receipt signing failed.");
  process.exitCode = 1;
});
