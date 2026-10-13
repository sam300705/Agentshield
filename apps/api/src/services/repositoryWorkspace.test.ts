import { access, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TemporaryRepositoryWorkspaceProvider } from "./repositoryWorkspace.js";

const payload = {
  organizationId: "org-1",
  repositoryId: "repo-1",
  provider: "GITHUB" as const,
  repositoryName: "acme/project",
  ref: "refs/heads/main",
  policyBundleVersion: "production@2.4.0",
  trigger: "MANUAL" as const,
  requester: "user-1",
  correlationId: "corr-1",
  options: {
    maxFiles: 10_000,
    maxBytes: 100_000_000,
    timeoutMs: 120_000,
    ignorePaths: [],
    includeOsv: false,
  },
};

describe("temporary repository workspace", () => {
  it("cleans a successful materialization", async () => {
    const materializer = {
      async materialize(_payload: typeof payload, workspacePath: string) {
        await writeFile(path.join(workspacePath, "README.md"), "safe fixture");
      },
    };
    const provider = new TemporaryRepositoryWorkspaceProvider(materializer, os.tmpdir());
    const workspace = await provider.prepare(payload, new AbortController().signal);
    const workspacePath = workspace.path;

    await expect(access(path.join(workspacePath, "README.md"))).resolves.toBeUndefined();
    await workspace.cleanup();
    await expect(access(workspacePath)).rejects.toThrow();
  });

  it("cleans a failed materialization", async () => {
    let createdPath = "";
    const materializer = {
      materialize(_payload: typeof payload, workspacePath: string): Promise<void> {
        createdPath = workspacePath;
        throw new Error("materialization failed");
      },
    };
    const provider = new TemporaryRepositoryWorkspaceProvider(materializer, os.tmpdir());

    await expect(provider.prepare(payload, new AbortController().signal)).rejects.toThrow(
      "materialization failed",
    );
    await expect(access(createdPath)).rejects.toThrow();
  });
});
