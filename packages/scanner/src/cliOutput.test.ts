import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
async function scan(root: string, format: string, osv = false) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("src/cli.ts"),
      "--path",
      root,
      "--format",
      format,
      ...(osv ? ["--osv"] : []),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let error = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    error += data.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  expect(code, error).not.toBe(4);
  return output;
}
it.each(["json", "jsonl"])(
  "redacts Dockerfile URL credentials in actual CLI %s output",
  async (format) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentshield-output-"));
    const secret = "syntheticcredential0123456789";
    try {
      await writeFile(
        path.join(root, "Dockerfile"),
        `FROM node:22\nRUN curl https://example.test/install?token=${secret} | sh\n`,
      );
      const output = await scan(root, format);
      expect(output).not.toContain(secret);
      expect(output).toContain("REDACTED");
      const findings =
        format === "json"
          ? (JSON.parse(output) as { findings: unknown[] }).findings
          : output
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line) as { type: string; finding?: unknown })
              .filter((line) => line.type === "finding")
              .map((line) => line.finding);
      expect(findings.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
it("reports version ranges as unresolved diagnostics rather than OSV advisories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentshield-advisories-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { alpha: "^1.2.3" } }),
    );
    const human = await scan(root, "human", true);
    expect(human).not.toContain("OSV advisories:");
    expect(human).toContain("Unresolved dependency versions: 1");
    const json = JSON.parse(await scan(root, "json", true)) as {
      advisoryCount: number;
      unresolvedCount: number;
    };
    expect(json.advisoryCount).toBe(0);
    expect(json.unresolvedCount).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
