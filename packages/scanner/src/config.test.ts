import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadRepositoryScanConfig } from "./config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("repository scan configuration", () => {
  it("loads bounded data-only ignore settings from YAML and ignore files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentshield-config-test-"));
    temporaryDirectories.push(directory);
    await writeFile(
      path.join(directory, ".agentshield.yml"),
      "ignorePaths:\n  - generated\n  - vendor/cache\n",
      "utf8",
    );
    await writeFile(
      path.join(directory, ".agentshieldignore"),
      "# local exclusions\nsecrets/example.txt\n\n",
      "utf8",
    );

    await expect(loadRepositoryScanConfig(directory)).resolves.toEqual({
      ignorePatterns: ["generated", "vendor/cache", "secrets/example.txt"],
    });
  });

  it("returns empty settings when repository configuration is absent", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentshield-config-test-"));
    temporaryDirectories.push(directory);

    await expect(loadRepositoryScanConfig(directory)).resolves.toEqual({ ignorePatterns: [] });
  });

  it("rejects unknown YAML fields instead of silently changing scanner behavior", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentshield-config-test-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, ".agentshield.yml"), "execute: true\n", "utf8");

    await expect(loadRepositoryScanConfig(directory)).rejects.toThrow();
  });
});
