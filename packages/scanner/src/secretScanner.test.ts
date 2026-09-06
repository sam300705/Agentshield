import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanFileForSecrets } from "./secretScanner.js";

let temporaryDirectory: string | undefined;
afterEach(async () => {
  if (temporaryDirectory != null) await rm(temporaryDirectory, { recursive: true });
});

describe("secret scanner", () => {
  it("detects and redacts high-confidence credentials", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agentshield-scanner-"));
    const filePath = path.join(temporaryDirectory, ".env");
    const secret = ["AKIA", "1234567890ABCDEF"].join("");
    await writeFile(filePath, `AWS_ACCESS_KEY_ID=${secret}\n`);
    const findings = await scanFileForSecrets({
      scanId: "scan-1",
      targetRoot: temporaryDirectory,
      filePath,
    });
    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(findings[0]?.evidence.matchedText).toContain("[REDACTED]");
  });

  it("does not report short example placeholders", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agentshield-scanner-"));
    const filePath = path.join(temporaryDirectory, ".env.example");
    await writeFile(filePath, "API_KEY=replace-me\n");
    expect(
      await scanFileForSecrets({ scanId: "scan-1", targetRoot: temporaryDirectory, filePath }),
    ).toEqual([]);
  });
});
