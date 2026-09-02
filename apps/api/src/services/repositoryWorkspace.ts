import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ScanJobPayload } from "@agentshield/schemas";

import type { RepositoryWorkspace, RepositoryWorkspaceProvider } from "./scanJobExecutor.js";

export interface RepositoryMaterializer {
  materialize(payload: ScanJobPayload, workspacePath: string, signal: AbortSignal): Promise<void>;
}

export class TemporaryRepositoryWorkspaceProvider implements RepositoryWorkspaceProvider {
  constructor(
    private readonly materializer: RepositoryMaterializer,
    private readonly tempRoot = os.tmpdir(),
  ) {}

  async prepare(payload: ScanJobPayload, signal: AbortSignal): Promise<RepositoryWorkspace> {
    if (signal.aborted) throw new Error("Scan cancelled");
    const workspacePath = await mkdtemp(path.join(this.tempRoot, "agentshield-scan-"));
    try {
      await this.materializer.materialize(payload, workspacePath, signal);
      if (signal.aborted) throw new Error("Scan cancelled");
      return {
        path: workspacePath,
        cleanup: () => this.cleanup(workspacePath),
      };
    } catch (error) {
      await this.cleanup(workspacePath);
      throw error;
    }
  }

  private async cleanup(workspacePath: string): Promise<void> {
    const resolvedRoot = path.resolve(this.tempRoot);
    const resolvedWorkspace = path.resolve(workspacePath);
    if (!resolvedWorkspace.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("Workspace cleanup path escaped the configured temporary root.");
    }
    await rm(resolvedWorkspace, { recursive: true, force: true, maxRetries: 3 });
  }
}
