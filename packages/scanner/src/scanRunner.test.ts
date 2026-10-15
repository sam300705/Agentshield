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
    await writeFile(
      path.join(root, ".agentshieldrc.json"),
      JSON.stringify({ ignorePatterns: ["*"] }),
    );
    const result = await runScan(root, "scan");
    expect(result.findings.some((finding) => finding.filePath === "src/.env")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.scannedFiles).toContain("src/.env");
    expect(result.skippedFiles).toEqual([]);

    // An explicit trusted caller may still choose exclusions; their provenance must be recorded.
    const trusted = await runScan(root, "trusted", { ignorePatterns: ["src"] });
    expect(trusted.findings).toEqual([]);
    expect(trusted.skippedFiles).toContain("src");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("proves ignore matching semantics under exact prefix vs wildcard patterns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentshield-matching-"));
  try {
    await mkdir(path.join(root, "test-dir"));
    const secret = ["AKIA", "1234567890ABCDEF"].join("");
    await writeFile(path.join(root, "test-dir", ".env"), `AWS_ACCESS_KEY_ID=${secret}\n`);

    // Wildcard glob '*' does not match test-dir/.env because matching uses exact prefix equality
    const globAttempt = await runScan(root, "glob", { ignorePatterns: ["*"] });
    expect(globAttempt.findings.some((f) => f.filePath === "test-dir/.env")).toBe(true);
    expect(globAttempt.skippedFiles).toEqual([]);

    // Exact directory prefix does match and is reported in skippedFiles
    const exactPrefix = await runScan(root, "prefix", { ignorePatterns: ["test-dir/"] });
    expect(exactPrefix.findings).toEqual([]);
    expect(exactPrefix.skippedFiles).toContain("test-dir");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("distinguishes enumerated, inspected, unsupported and excluded entries without guessing hidden files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentshield-coverage-"));
  try {
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "hidden.txt"), "not enumerated");
    await writeFile(path.join(root, "readme.txt"), "safe text");
    await writeFile(path.join(root, "image.png"), new Uint8Array([0, 1, 2]));
    const result = await runScan(root, "coverage");
    expect(result.coverage).toMatchObject({
      status: "PARTIAL",
      enumeratedFiles: 2,
      inspectedFiles: 1,
      unsupportedFiles: 1,
      excludedEntries: 1,
    });
    expect(result.scannedFiles).toEqual(["readme.txt"]);
    await expect(runScan(root, "limited", { maxFiles: 1 })).rejects.toThrow("file limit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
