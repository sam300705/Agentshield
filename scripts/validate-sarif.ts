import { readFile } from "node:fs/promises";

interface SarifRun {
  tool?: { driver?: { name?: unknown; version?: unknown; rules?: unknown } };
  results?: unknown;
}

interface SarifDocument {
  $schema?: unknown;
  version?: unknown;
  runs?: unknown;
}

function fail(message: string): never {
  throw new Error(`Invalid SARIF: ${message}`);
}

function assertString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) fail(`${field} must be a non-empty string`);
}

export function validateSarif(value: unknown): void {
  if (typeof value !== "object" || value == null || Array.isArray(value))
    fail("document must be an object");
  const document = value as SarifDocument;
  assertString(document.$schema, "$schema");
  assertString(document.version, "version");
  if (document.version !== "2.1.0") fail("version must be 2.1.0");
  if (!Array.isArray(document.runs) || document.runs.length === 0)
    fail("runs must be a non-empty array");
  for (const [index, runValue] of document.runs.entries()) {
    if (typeof runValue !== "object" || runValue == null || Array.isArray(runValue)) {
      fail(`runs[${index}] must be an object`);
    }
    const run = runValue as SarifRun;
    assertString(run.tool?.driver?.name, `runs[${index}].tool.driver.name`);
    assertString(run.tool?.driver?.version, `runs[${index}].tool.driver.version`);
    if (!Array.isArray(run.results)) fail(`runs[${index}].results must be an array`);
  }
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (filePath == null || filePath.length === 0) {
    throw new Error("Usage: validate-sarif <file>");
  }
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  validateSarif(parsed);
  process.stdout.write(`SARIF validation passed: ${filePath}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
