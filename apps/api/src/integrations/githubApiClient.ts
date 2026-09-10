import { createPrivateKey, type KeyObject } from "node:crypto";

import { SignJWT } from "jose";
import { z } from "zod";

import type {
  GitHubAppClient,
  GitHubAppConfig,
  GitHubInstallationMetadata,
  GitHubRepository,
} from "./githubApp.js";
import type {
  GitHubCheckRunIdentity,
  GitHubCheckRunRequest,
  GitHubChecksClient,
} from "./githubChecks.js";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2026-03-10";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SAFE_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_REPOSITORY_PAGES = 100;

type FetchLike = typeof fetch;
type RetryMode = "none" | "safe";

const installationTokenResponseSchema = z.object({
  token: z.string().min(1).max(4096),
  expires_at: z.string().min(1).max(128),
});

const installationResponseSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({
    login: z.string().min(1).max(128),
    type: z.string().min(1).max(64),
  }),
  permissions: z.record(z.string(), z.unknown()).optional().default({}),
  suspended_at: z.string().nullable().optional(),
});

const repositoryResponseSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(3).max(256),
  private: z.boolean(),
  default_branch: z.string().min(1).max(255).nullable(),
  permissions: z
    .object({
      admin: z.boolean().optional(),
      push: z.boolean().optional(),
      pull: z.boolean().optional(),
    })
    .optional(),
});

const repositoryListResponseSchema = z.object({
  repositories: z.array(repositoryResponseSchema).max(100),
});

const checkRunResponseSchema = z.object({
  id: z.number().int().positive(),
  html_url: z.string().url().optional(),
});

const checkRunsResponseSchema = z.object({
  check_runs: z
    .array(
      z.object({
        id: z.number().int().positive(),
        external_id: z.string().max(512).nullable().optional(),
        html_url: z.string().url().optional(),
      }),
    )
    .max(100),
});

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface GitHubArchiveClient {
  downloadRepositoryArchive(
    owner: string,
    repository: string,
    commitSha: string,
    token: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface GitHubApiClientOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  apiVersion?: string;
  now?: () => number;
  installationToken?: string;
  requestTimeoutMs?: number;
  maxSafeRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class FetchGitHubAppClient
  implements GitHubAppClient, GitHubChecksClient, GitHubArchiveClient
{
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly now: () => number;
  private readonly installationToken: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly maxSafeRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly config: GitHubAppConfig,
    options: GitHubApiClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.now = options.now ?? Date.now;
    this.installationToken = options.installationToken;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxSafeRetries = options.maxSafeRetries ?? DEFAULT_SAFE_RETRIES;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("GitHub request timeout must be a positive integer.");
    }
    if (!Number.isSafeInteger(this.maxSafeRetries) || this.maxSafeRetries < 0) {
      throw new Error("GitHub safe retry count must be a non-negative integer.");
    }
  }

  withInstallationToken(token: string): FetchGitHubAppClient {
    if (token.length === 0) throw new Error("GitHub installation token is required.");
    return new FetchGitHubAppClient(this.config, {
      fetchImpl: this.fetchImpl,
      apiBaseUrl: this.apiBaseUrl,
      apiVersion: this.apiVersion,
      now: this.now,
      installationToken: token,
      requestTimeoutMs: this.requestTimeoutMs,
      maxSafeRetries: this.maxSafeRetries,
      sleep: this.sleep,
      random: this.random,
    });
  }

  private loadPrivateKey(): KeyObject {
    let key: KeyObject;
    try {
      key = createPrivateKey(this.config.privateKey);
    } catch {
      throw new Error("GitHub App private key is not a valid RSA private key.");
    }
    if (key.type !== "private" || key.asymmetricKeyType !== "rsa") {
      throw new Error("GitHub App private key must be an RSA private key.");
    }
    return key;
  }

  private async createAppJwt(): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1_000) - 60;
    const key = this.loadPrivateKey();
    try {
      return await new SignJWT({ iss: this.config.appId })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 9 * 60)
        .sign(key);
    } catch {
      throw new Error("GitHub App private key could not sign an RS256 JWT.");
    }
  }

  async validateAppCredentials(): Promise<void> {
    await this.createAppJwt();
  }

  private retryDelay(response: Response | null, attempt: number): number {
    if (response != null) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter != null) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
          return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1_000));
        }
      }
      const reset = response.headers.get("x-ratelimit-reset");
      if (reset != null) {
        const epochSeconds = Number(reset);
        if (Number.isFinite(epochSeconds)) {
          return Math.min(
            MAX_RETRY_DELAY_MS,
            Math.max(0, Math.ceil(epochSeconds * 1_000 - this.now())),
          );
        }
      }
    }
    const base = Math.min(5_000, 250 * 2 ** attempt);
    return Math.min(MAX_RETRY_DELAY_MS, base + Math.floor(this.random() * Math.max(1, base / 4)));
  }

  private isRetryableResponse(response: Response): boolean {
    if (response.status === 429 || response.status >= 500) return true;
    if (response.status !== 403) return false;
    return (
      response.headers.get("retry-after") != null ||
      response.headers.get("x-ratelimit-remaining") === "0"
    );
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    token: string,
    schema: z.ZodType<T>,
    body?: Record<string, unknown>,
    retryMode: RetryMode = "none",
  ): Promise<{ data: T; headers: Headers }> {
    const retries = retryMode === "safe" ? this.maxSafeRetries : 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": this.apiVersion,
            ...(body == null ? {} : { "Content-Type": "application/json" }),
          },
          ...(body == null ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch {
        if (attempt < retries) {
          await this.sleep(this.retryDelay(null, attempt));
          continue;
        }
        throw new GitHubApiError("GitHub API request failed before receiving a response.", null, null);
      }

      if (!response.ok) {
        const retryAfterMs = this.retryDelay(response, attempt);
        if (attempt < retries && this.isRetryableResponse(response)) {
          await this.sleep(retryAfterMs);
          continue;
        }
        throw new GitHubApiError(
          `GitHub API request failed with status ${response.status}.`,
          response.status,
          this.isRetryableResponse(response) ? retryAfterMs : null,
        );
      }

      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new GitHubApiError("GitHub API returned invalid JSON.", response.status, null);
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new GitHubApiError("GitHub API returned an invalid response shape.", response.status, null);
      }
      return { data: parsed.data, headers: response.headers };
    }
    throw new GitHubApiError("GitHub API retry budget exhausted.", null, null);
  }

  async getInstallation(installationId: number): Promise<GitHubInstallationMetadata> {
    const jwt = await this.createAppJwt();
    const { data } = await this.request(
      "GET",
      `/app/installations/${installationId}`,
      jwt,
      installationResponseSchema,
      undefined,
      "safe",
    );
    if (data.id !== installationId) {
      throw new Error("GitHub returned invalid installation metadata.");
    }
    const permissions = Object.fromEntries(
      Object.entries(data.permissions).filter(
        (entry): entry is [string, string] =>
          entry[0].length > 0 &&
          entry[0].length <= 128 &&
          typeof entry[1] === "string" &&
          entry[1].length <= 64,
      ),
    );
    return {
      installationId: data.id,
      accountLogin: data.account.login,
      accountType: data.account.type,
      permissions,
      suspended: data.suspended_at != null,
    };
  }

  async downloadRepositoryArchive(
    owner: string,
    repository: string,
    commitSha: string,
    token: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
      throw new Error("GitHub archive materialization requires a full commit SHA.");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball/${encodeURIComponent(commitSha)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": this.apiVersion,
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeoutMs)]),
        },
      );
    } catch {
      if (signal.aborted) throw new Error("GitHub archive request was cancelled.");
      throw new Error("GitHub archive request failed before receiving a response.");
    }
    if (!response.ok || response.body == null) {
      throw new Error(`GitHub archive request failed with status ${response.status}.`);
    }
    return response.body;
  }

  async createInstallationToken(
    installationId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const jwt = await this.createAppJwt();
    const { data } = await this.request(
      "POST",
      `/app/installations/${installationId}/access_tokens`,
      jwt,
      installationTokenResponseSchema,
    );
    const expiresAt = new Date(data.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("GitHub returned an invalid installation token response.");
    }
    return { token: data.token, expiresAt };
  }

  async listInstallationRepositories(
    installationId: number,
    token: string,
  ): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const { data } = await this.request(
        "GET",
        `/installation/repositories?per_page=100&page=${page}`,
        token,
        repositoryListResponseSchema,
        undefined,
        "safe",
      );
      const pageItems = data.repositories.map((repository) => ({
        id: repository.id,
        fullName: repository.full_name,
        private: repository.private,
        defaultBranch: repository.default_branch,
        permissions: {
          admin: repository.permissions?.admin === true,
          push: repository.permissions?.push === true,
          pull: repository.permissions?.pull === true,
        },
      }));
      repositories.push(...pageItems);
      if (pageItems.length < 100) return repositories;
    }
    throw new Error(
      `GitHub installation ${installationId} repository list exceeded the synchronization safety limit.`,
    );
  }

  async getRepository(owner: string, repository: string, token: string): Promise<GitHubRepository> {
    const { data } = await this.request(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
      token,
      repositoryResponseSchema,
      undefined,
      "safe",
    );
    return {
      id: data.id,
      fullName: data.full_name,
      private: data.private,
      defaultBranch: data.default_branch,
      permissions: {
        admin: data.permissions?.admin === true,
        push: data.permissions?.push === true,
        pull: data.permissions?.pull === true,
      },
    };
  }

  private checkBody(request: GitHubCheckRunRequest): Record<string, unknown> {
    return {
      name: request.name,
      head_sha: request.headSha,
      external_id: request.externalId,
      status: request.status,
      ...(request.conclusion == null ? {} : { conclusion: request.conclusion }),
      ...(request.detailsUrl == null ? {} : { details_url: request.detailsUrl }),
      ...(request.startedAt == null ? {} : { started_at: request.startedAt.toISOString() }),
      ...(request.completedAt == null ? {} : { completed_at: request.completedAt.toISOString() }),
      output: {
        title: request.output.title,
        summary: request.output.summary,
        ...(request.output.text == null ? {} : { text: request.output.text }),
        ...(request.output.annotations == null
          ? {}
          : {
              annotations: request.output.annotations.map((annotation) => ({
                path: annotation.path,
                start_line: annotation.startLine,
                end_line: annotation.endLine,
                annotation_level: annotation.level,
                title: annotation.title,
                message: annotation.message,
              })),
            }),
      },
    };
  }

  async createCheckRun(request: GitHubCheckRunRequest): Promise<{ id: number; htmlUrl?: string }> {
    const { data } = await this.request(
      "POST",
      `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repository)}/check-runs`,
      this.requireInstallationToken(),
      checkRunResponseSchema,
      this.checkBody(request),
      "none",
    );
    return { id: data.id, ...(data.html_url == null ? {} : { htmlUrl: data.html_url }) };
  }

  async updateCheckRun(
    owner: string,
    repository: string,
    checkRunId: number,
    request: GitHubCheckRunRequest,
  ): Promise<{ id: number; htmlUrl?: string }> {
    const { data } = await this.request(
      "PATCH",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs/${checkRunId}`,
      this.requireInstallationToken(),
      checkRunResponseSchema,
      this.checkBody(request),
      "safe",
    );
    return { id: data.id, ...(data.html_url == null ? {} : { htmlUrl: data.html_url }) };
  }

  async findCheckRunByExternalId(
    owner: string,
    repository: string,
    headSha: string,
    externalId: string,
  ): Promise<GitHubCheckRunIdentity | null> {
    const { data } = await this.request(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(headSha)}/check-runs?check_name=AgentShield&filter=latest&per_page=100`,
      this.requireInstallationToken(),
      checkRunsResponseSchema,
      undefined,
      "safe",
    );
    const match = data.check_runs.find((checkRun) => checkRun.external_id === externalId);
    if (match == null) return null;
    return {
      id: match.id,
      externalId: match.external_id ?? null,
      ...(match.html_url == null ? {} : { htmlUrl: match.html_url }),
    };
  }

  private requireInstallationToken(): string {
    if (this.installationToken == null || this.installationToken.length === 0) {
      throw new Error("GitHub installation token is required for Checks API operations.");
    }
    return this.installationToken;
  }
}
