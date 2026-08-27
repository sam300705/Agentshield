import { scanJobPayloadSchema, scanOptionsSchema, type ScanJobPayload } from "@agentshield/schemas";

import { runConfiguredScan, runDemoScan } from "./scanService.js";

export interface RepositoryWorkspace {
  path: string;
  cleanup(): Promise<void>;
}

export interface RepositoryWorkspaceProvider {
  prepare(payload: ScanJobPayload, signal: AbortSignal): Promise<RepositoryWorkspace>;
}

export interface ScanJobExecutionInput {
  scanId: string;
  payload: unknown;
  signal: AbortSignal;
}

export interface ScanJobExecutor {
  execute(input: ScanJobExecutionInput): Promise<string>;
}

export class ConfiguredScanJobExecutor implements ScanJobExecutor {
  constructor(private readonly workspaceProvider?: RepositoryWorkspaceProvider) {}

  async execute(input: ScanJobExecutionInput): Promise<string> {
    const payload = scanJobPayloadSchema.parse(input.payload);
    if (payload.provider === "LOCAL" && payload.repositoryId === "local-demo") {
      if (payload.organizationId.length === 0) throw new Error("SCAN_ORGANIZATION_REQUIRED");
      return runDemoScan(input.scanId, payload.organizationId, payload.correlationId, input.signal);
    }

    if (this.workspaceProvider == null) {
      throw new Error(`SCAN_PROVIDER_NOT_CONFIGURED:${payload.provider}`);
    }

    const workspace = await this.workspaceProvider.prepare(payload, input.signal);
    try {
      if (input.signal.aborted) throw new Error("Scan cancelled");
      const options = scanOptionsSchema.parse(payload.options);
      return await runConfiguredScan(
        {
          source: payload.provider === "GITHUB" ? "GITHUB" : "MANUAL",
          targetPath: workspace.path,
          targetPathLabel: `workspace:${payload.repositoryId}`,
          repositoryName: payload.repositoryName,
          ...(payload.repositoryUrl == null ? {} : { repositoryUrl: payload.repositoryUrl }),
          branch: payload.ref,
          ...(payload.commitSha == null ? {} : { commitSha: payload.commitSha }),
          organizationId: payload.organizationId,
          correlationId: payload.correlationId,
          triggeredBy: payload.requester,
          labels: [payload.trigger.toLowerCase(), payload.provider.toLowerCase()],
          options,
          signal: input.signal,
        },
        input.scanId,
      );
    } finally {
      await workspace.cleanup();
    }
  }
}

export const defaultScanJobExecutor = new ConfiguredScanJobExecutor();
