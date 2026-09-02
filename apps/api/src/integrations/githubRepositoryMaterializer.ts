import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";
import { extract } from "tar";
import type { ReadEntry } from "tar";

import { scanJobPayloadSchema, type ScanJobPayload } from "@agentshield/schemas";

import type { GitHubArchiveClient } from "./githubApiClient.js";
import type { RepositoryMaterializer } from "../services/repositoryWorkspace.js";

export interface GitHubRepositoryBinding {
  organizationId: string;
  repositoryId: string;
  fullName: string;
  installationId: number;
}

export interface GitHubRepositoryBindingResolver {
  resolve(organizationId: string, repositoryId: string): Promise<GitHubRepositoryBinding | null>;
}

export interface GitHubInstallationTokenProvider {
  getInstallationToken(installationId: number): Promise<string>;
}

export interface GitHubArchiveLimits {
  maxCompressedBytes: number;
  maxExtractedBytes: number;
  maxFiles: number;
  maxFileBytes: number;
}

const DEFAULT_LIMITS: GitHubArchiveLimits = {
  maxCompressedBytes: 250 * 1024 * 1024,
  maxExtractedBytes: 1_000 * 1024 * 1024,
  maxFiles: 100_000,
  maxFileBytes: 100 * 1024 * 1024,
};

export interface GitHubRepositoryMaterializerOptions {
  enabled: boolean;
  archiveClient: GitHubArchiveClient;
  tokenProvider: GitHubInstallationTokenProvider;
  bindingResolver: GitHubRepositoryBindingResolver;
  limits?: Partial<GitHubArchiveLimits>;
}

function splitRepositoryName(fullName: string): { owner: string; repository: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part))) {
    throw new Error("GITHUB_REPOSITORY_IDENTITY_INVALID");
  }
  return { owner: parts[0]!, repository: parts[1]! };
}

function validateRelativeArchivePath(workspacePath: string, archivePath: string): void {
  const normalized = archivePath.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("GITHUB_ARCHIVE_PATH_INVALID");
  }
  const resolvedWorkspace = path.resolve(workspacePath);
  const resolvedEntry = path.resolve(workspacePath, normalized);
  if (!resolvedEntry.startsWith(`${resolvedWorkspace}${path.sep}`)) {
    throw new Error("GITHUB_ARCHIVE_PATH_ESCAPE");
  }
}

export class GitHubRepositoryMaterializer implements RepositoryMaterializer {
  private readonly limits: GitHubArchiveLimits;

  constructor(private readonly options: GitHubRepositoryMaterializerOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    if (
      this.limits.maxCompressedBytes <= 0 ||
      this.limits.maxExtractedBytes <= 0 ||
      this.limits.maxFiles <= 0 ||
      this.limits.maxFileBytes <= 0
    ) {
      throw new Error("GITHUB_ARCHIVE_LIMITS_INVALID");
    }
  }

  async materialize(
    rawPayload: ScanJobPayload,
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const payload = scanJobPayloadSchema.parse(rawPayload);
    if (!this.options.enabled) throw new Error("GITHUB_MATERIALIZATION_DISABLED");
    if (payload.provider !== "GITHUB") throw new Error("GITHUB_MATERIALIZER_PROVIDER_MISMATCH");
    if (payload.integrationId == null || !/^\d+$/.test(payload.integrationId)) {
      throw new Error("GITHUB_INSTALLATION_REQUIRED");
    }
    if (payload.commitSha == null || !/^[a-f0-9]{40}$/i.test(payload.commitSha)) {
      throw new Error("GITHUB_COMMIT_SHA_REQUIRED");
    }
    if (signal.aborted) throw new Error("Scan cancelled");

    const binding = await this.options.bindingResolver.resolve(
      payload.organizationId,
      payload.repositoryId,
    );
    if (
      binding == null ||
      binding.organizationId !== payload.organizationId ||
      binding.repositoryId !== payload.repositoryId ||
      binding.fullName !== payload.repositoryName ||
      binding.installationId !== Number(payload.integrationId)
    ) {
      throw new Error("GITHUB_REPOSITORY_MAPPING_INVALID");
    }

    const token = await this.options.tokenProvider.getInstallationToken(binding.installationId);
    if (token.length === 0) throw new Error("GITHUB_INSTALLATION_TOKEN_UNAVAILABLE");
    const { owner, repository } = splitRepositoryName(binding.fullName);
    const archive = await this.options.archiveClient.downloadRepositoryArchive(
      owner,
      repository,
      payload.commitSha,
      token,
      signal,
    );
    await this.extractArchive(archive, workspacePath, signal);
  }

  private async extractArchive(
    archive: ReadableStream<Uint8Array>,
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    let compressedBytes = 0;
    let extractedBytes = 0;
    let files = 0;
    let aborted = false;
    let failure: Error | undefined;
    const thisLimits = this.limits;
    const abortError = () => new Error("Scan cancelled");
    const abort = () => {
      aborted = true;
      limiter.destroy(abortError());
    };
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        compressedBytes += chunk.length;
        if (compressedBytes > thisLimits.maxCompressedBytes) {
          callback(new Error("GITHUB_ARCHIVE_COMPRESSED_LIMIT"));
          return;
        }
        callback(null, chunk);
      },
    });
    const fail = (message: string): void => {
      const error = new Error(message);
      failure ??= error;
      limiter.destroy(error);
    };
    const extractor = extract({
      cwd: workspacePath,
      strip: 1,
      strict: true,
      preservePaths: false,
      noMtime: true,
      onentry: (entry: ReadEntry) => {
        if (aborted || signal.aborted) {
          failure ??= abortError();
          return;
        }
        if (failure != null) return;
        try {
          validateRelativeArchivePath(workspacePath, entry.path);
        } catch (error) {
          fail(error instanceof Error ? error.message : "GITHUB_ARCHIVE_PATH_INVALID");
          return;
        }
        if (entry.type !== "File" && entry.type !== "Directory") {
          fail("GITHUB_ARCHIVE_LINK_OR_DEVICE_REJECTED");
          return;
        }
        if (entry.type === "File") {
          files += 1;
          if (files > thisLimits.maxFiles) {
            fail("GITHUB_ARCHIVE_FILE_COUNT_LIMIT");
            return;
          }
          if (entry.size > thisLimits.maxFileBytes) {
            fail("GITHUB_ARCHIVE_FILE_SIZE_LIMIT");
            return;
          }
          extractedBytes += entry.size;
          if (extractedBytes > thisLimits.maxExtractedBytes) {
            fail("GITHUB_ARCHIVE_EXTRACTED_LIMIT");
          }
        }
      },
    });
    signal.addEventListener("abort", abort, { once: true });
    try {
      await pipeline(Readable.fromWeb(archive), limiter, extractor);
      if (signal.aborted) throw abortError();
      if (failure != null) throw failure;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
}
