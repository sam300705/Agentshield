import { SignJWT } from "jose";
import { createPrivateKey } from "node:crypto";

import type { GitHubAppClient, GitHubAppConfig, GitHubRepository } from "./githubApp.js";
import type { GitHubCheckRunRequest, GitHubChecksClient } from "./githubChecks.js";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2026-03-10";
const MAX_REPOSITORY_PAGES = 10;

type FetchLike = typeof fetch;

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

interface RepositoryListResponse {
  repositories: Array<{
    id: number;
    full_name: string;
    private: boolean;
    default_branch: string | null;
    permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  }>;
}

interface CheckRunResponse {
  id: number;
  html_url?: string;
}

export interface GitHubArchiveClient {
  getRepository(owner: string, repository: string, token: string): Promise<GitHubRepository>;
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
  signal?: AbortSignal;
}

export class FetchGitHubAppClient
  implements GitHubAppClient, GitHubChecksClient, GitHubArchiveClient
{
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly now: () => number;
  private readonly installationToken: string | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(
    private readonly config: GitHubAppConfig,
    options: GitHubApiClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
    if (this.apiBaseUrl !== DEFAULT_API_BASE_URL && options.fetchImpl == null)
      throw new Error("GITHUB_API_ORIGIN_INVALID");
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.now = options.now ?? Date.now;
    this.installationToken = options.installationToken;
    this.signal = options.signal;
  }

  withInstallationToken(token: string): FetchGitHubAppClient {
    if (token.length === 0) throw new Error("GitHub installation token is required.");
    return new FetchGitHubAppClient(this.config, {
      fetchImpl: this.fetchImpl,
      apiBaseUrl: this.apiBaseUrl,
      apiVersion: this.apiVersion,
      now: this.now,
      installationToken: token,
      ...(this.signal == null ? {} : { signal: this.signal }),
    });
  }

  withSignal(signal: AbortSignal): FetchGitHubAppClient {
    return new FetchGitHubAppClient(this.config, {
      fetchImpl: this.fetchImpl,
      apiBaseUrl: this.apiBaseUrl,
      apiVersion: this.apiVersion,
      now: this.now,
      signal,
      ...(this.installationToken == null ? {} : { installationToken: this.installationToken }),
    });
  }

  private async createAppJwt(): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1_000) - 60;
    const key = validateGitHubPrivateKey(this.config.privateKey);
    return new SignJWT({ iss: this.config.appId })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 9 * 60)
      .sign(key);
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    token: string,
    body?: Record<string, unknown>,
  ): Promise<{ data: T; headers: Headers }> {
    const headers = this.headers(token, body != null);
    let response: Response | undefined;
    for (let attempt = 0; attempt < (method === "POST" ? 1 : 3); attempt++) {
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          method,
          headers,
          redirect: "error",
          signal:
            this.signal == null
              ? AbortSignal.timeout(8_000)
              : AbortSignal.any([this.signal, AbortSignal.timeout(8_000)]),
          ...(body == null ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        if (attempt === 2 || method === "POST") throw new GitHubApiError(0, true);
        continue;
      }
      if (response.ok) break;
      const retryable =
        [429, 502, 503, 504].includes(response.status) ||
        (response.status === 403 &&
          (response.headers.has("retry-after") ||
            response.headers.get("x-ratelimit-remaining") === "0"));
      const retryAfterMs = providerRetryDelay(response.headers);
      if (!retryable || attempt === 2 || method === "POST")
        throw new GitHubApiError(response.status, retryable, retryAfterMs);
      const delay = retryAfterMs ?? 250 * 2 ** attempt;
      // Long provider delays belong to the durable publisher, not a blocked worker.
      if (!Number.isFinite(delay) || delay > 2_000)
        throw new GitHubApiError(response.status, true, retryAfterMs);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
    }
    if (response == null || !response.ok) throw new GitHubApiError(0, true);

    try {
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error();
      return { data: JSON.parse(text) as T, headers: response.headers };
    } catch {
      throw new GitHubApiError(0, false);
    }
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
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    let response = await this.fetchImpl(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball/${encodeURIComponent(commitSha)}`,
      { method: "GET", headers: this.headers(token), signal: requestSignal, redirect: "manual" },
    );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (location == null) throw new GitHubApiError(0, false);
      const target = new URL(location);
      if (
        target.protocol !== "https:" ||
        target.hostname !== "codeload.github.com" ||
        target.port !== "" ||
        target.username !== "" ||
        target.password !== "" ||
        !target.pathname.startsWith(`/${owner}/${repository}/`)
      )
        throw new Error("GITHUB_ARCHIVE_REDIRECT_REJECTED");
      // The signed archive URL carries its authorization; never forward the installation token.
      response = await this.fetchImpl(target, {
        method: "GET",
        signal: requestSignal,
        redirect: "error",
        headers: { "User-Agent": "AgentShield" },
      });
    }
    if (!response.ok || response.body == null)
      throw new GitHubApiError(response.status, [429, 502, 503, 504].includes(response.status));

    return response.body;
  }

  async createInstallationToken(
    installationId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const jwt = await this.createAppJwt();
    const { data } = await this.request<InstallationTokenResponse>(
      "POST",
      `/app/installations/${installationId}/access_tokens`,
      jwt,
    );
    const expiresAt = new Date(data.expires_at);
    if (
      typeof data.token !== "string" ||
      data.token.length === 0 ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= this.now() ||
      expiresAt.getTime() > this.now() + 3_660_000
    ) {
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
      const { data } = await this.request<RepositoryListResponse>(
        "GET",
        `/installation/repositories?per_page=100&page=${page}`,
        token,
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
    throw new Error("GITHUB_REPOSITORY_PAGE_LIMIT");
  }

  async getRepository(owner: string, repository: string, token: string): Promise<GitHubRepository> {
    const { data } = await this.request<RepositoryListResponse["repositories"][number]>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
      token,
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

  private headers(token: string, json = false): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "AgentShield",
      "X-GitHub-Api-Version": this.apiVersion,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  async getInstallation(
    installationId: number,
  ): Promise<{ id: number; account: { login: string; type: string } }> {
    const { data } = await this.request<{ id: number; account: { login: string; type: string } }>(
      "GET",
      `/app/installations/${installationId}`,
      await this.createAppJwt(),
    );
    if (data.id !== installationId || typeof data.account?.login !== "string")
      throw new Error("GITHUB_INSTALLATION_INVALID");
    return data;
  }

  async findCheckRun(
    owner: string,
    repository: string,
    headSha: string,
    externalId: string,
  ): Promise<number | null> {
    for (let page = 1; page <= 10; page++) {
      const { data } = await this.request<{
        check_runs: Array<{ id: number; external_id: string }>;
      }>(
        "GET",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${headSha}/check-runs?check_name=AgentShield%20Security&app_id=${encodeURIComponent(this.config.appId)}&filter=all&per_page=100&page=${page}`,
        this.requireInstallationToken(),
      );
      const found = data.check_runs.find((run) => run.external_id === externalId);
      if (found != null) return found.id;
      if (data.check_runs.length < 100) return null;
    }
    throw new Error("GITHUB_CHECK_PAGE_LIMIT");
  }

  async getCheckRun(
    owner: string,
    repository: string,
    checkRunId: number,
  ): Promise<{
    id: number;
    head_sha: string;
    external_id: string;
    status: string;
    conclusion: string;
  }> {
    return (
      await this.request<{
        id: number;
        head_sha: string;
        external_id: string;
        status: string;
        conclusion: string;
      }>(
        "GET",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs/${checkRunId}`,
        this.requireInstallationToken(),
      )
    ).data;
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
    const { data } = await this.request<CheckRunResponse>(
      "POST",
      `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repository)}/check-runs`,
      this.requireInstallationToken(),
      this.checkBody(request),
    );
    return data.html_url == null ? { id: data.id } : { id: data.id, htmlUrl: data.html_url };
  }

  async updateCheckRun(
    checkRunId: number,
    request: GitHubCheckRunRequest,
  ): Promise<{ id: number; htmlUrl?: string }> {
    const { data } = await this.request<CheckRunResponse>(
      "PATCH",
      `/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repository)}/check-runs/${checkRunId}`,
      this.requireInstallationToken(),
      this.checkBody(request),
    );
    return data.html_url == null ? { id: data.id } : { id: data.id, htmlUrl: data.html_url };
  }

  private requireInstallationToken(): string {
    if (this.installationToken == null) {
      throw new Error("GitHub Checks require an installation-scoped client.");
    }
    return this.installationToken;
  }
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(`GitHub provider request failed (${status}).`);
  }
}

export function validateGitHubPrivateKey(pem: string) {
  try {
    const key = createPrivateKey(pem.replaceAll("\\n", "\n"));
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      throw new Error();
    return key;
  } catch {
    throw new Error("GITHUB_PRIVATE_KEY_INVALID");
  }
}

function providerRetryDelay(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  const reset = headers.get("x-ratelimit-reset");
  const duration =
    value != null
      ? /^\d+$/.test(value)
        ? Number(value) * 1000
        : Date.parse(value) - Date.now()
      : reset != null
        ? Number(reset) * 1000 - Date.now()
        : NaN;
  return Number.isFinite(duration) ? Math.min(86_400_000, Math.max(0, duration)) : undefined;
}
