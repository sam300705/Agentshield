import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runScan } from "./scanRunner.js";

it("does not let a checkout exclude its own mandatory secret findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentshield-ignore-"));
  try {
    await mkdir(path.join(root, "src"));
    const secret = ["AKIA", "1234567890ABCDEF"].join("");
    await writeFile(path.join(root, "src", ".env"), `AWS_ACCESS_KEY_ID=${secret}\n`);
    await writeFile(path.join(root, ".agentshieldignore"), "src\n");
    await writeFile(path.join(root, ".agentshield.yml"), "ignorePaths:\n  - src\n");
    const result = await runScan(root, "scan");
    expect(result.findings.some((finding) => finding.filePath === "src/.env")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    // An explicit trusted caller may still choose exclusions; their provenance must be recorded.
    expect((await runScan(root, "trusted", { ignorePatterns: ["src"] })).findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
