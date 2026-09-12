import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SCANNER_RELEASE, SCANNER_VERSION } from "./version.js";

describe("scanner version", () => {
  it("matches the packaged scanner version exactly", () => {
    const packageJsonPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
      name?: unknown;
    };
    expect(packageJson.name).toBe("@agentshield/scanner");
    expect(SCANNER_VERSION).toBe(packageJson.version);
    expect(SCANNER_RELEASE).toBe(`agentshield-scanner@${packageJson.version as string}`);
  });
});
