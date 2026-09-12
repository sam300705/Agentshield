#!/usr/bin/env node
// Stable `agentshield` executable entrypoint.
//
// The `bin` target must exist at `pnpm install` time (before `dist/` is built),
// so this committed launcher delegates to the compiled CLI and fails with an
// actionable message when the package has not been built yet.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compiledCli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

if (!existsSync(compiledCli)) {
  console.error(
    "agentshield: dist/cli.js is missing. Build the package first: pnpm --filter @agentshield/scanner build",
  );
  process.exitCode = 1;
} else {
  await import(compiledCli);
}
