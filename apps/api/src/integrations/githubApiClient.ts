import { createPrivateKey, type KeyObject } from "node:crypto";

import { SignJWT } from "jose";

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
const MAX_REPOSITORY_PAGES = 100;

type FetchLike = typeof fetch;

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

interface InstallationResponse {
  id: number;
  account?: { login?: string; type?: string } | null;
  permissions?: Record<string, unknown>;
  suspended_at?: string | null;
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

interface CheckRunsResponse {
  check_runs: Array<{
    id: number;
    external_id?: string | null;
    html_url?: string;
  }>;
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
}

export class FetchGitHubAppClient
  implements GitHubAppClient, GitHubChecksClient, GitHubArchiveClient
{
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly now: () => number;
  private readonly installationToken: string | undefined;

  constructor(
    private readonly config: GitHubAppConfig,
    options: GitHubApiClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.now = options.now ?? Date.now;
    this.installationToken = options.installationToken;
  }

  withInstallationToken(token: string): FetchGitHubAppClient {
    if (token.length === 0) throw new Error("GitHub installation token is required.");
    return new FetchGitHubAppClient(this.config, {
      fetchImpl: this.fetchImpl,
      apiBaseUrl: this.apiBaseUrl,
      apiVersion: this.apiVersion,
      now: this.now,
      installationToken: token,
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

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    token: string,
    body?: Record<string, unknown>,
  ): Promise<{ data: T; headers: Headers }> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": this.apiVersion,
        ...(body == null ? {} : { "Content-Type": "application/json" }),
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}.`);
    }

    return { data: (await response.json()) as T, headers: response.headers };
  }

  async getInstallation(installationId: number): Promise<GitHubInstallationMetadata> {
    const jwt = await this.createAppJwt();
    const { data } = await this.request<InstallationResponse>(
      "GET",
      `/app/installations/${installationId}`,
      jwt,
    );
    const accountLogin = data.account?.login;
    const accountType = data.account?.type;
    if (
      data.id !== installationId ||
      typeof accountLogin !== "string" ||
      accountLogin.length === 0 ||
      accountLogin.length > 128 ||
      typeof accountType !== "string" ||
      accountType.length === 0 ||
      accountType.length > 64
    ) {
      throw new Error("GitHub returned invalid installation metadata.");
    }
    const permissions = Object.fromEntries(
      Object.entries(data.permissions ?? {}).filter(
        (entry): entry is [string, string] =>
          entry[0].length > 0 &&
          entry[0].length <= 128 &&
          typeof entry[1] === "string" &&
          entry[1].length <= 64,
      ),
    );
    return {
      installationId: data.id,
      accountLogin,
      accountType,
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
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball/${encodeURIComponent(commitSha)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": this.apiVersion,
        },
        signal,
      },
    );
    if (!response.ok || response.body == null) {
      throw new Error(`GitHub archive request failed with status ${response.status}.`);
    }
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
    if (data.token.length === 0 || Number.isNaN(expiresAt.getTime())) {
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
    throw new Error(
      `GitHub installation ${installationId} repository list exceeded the synchronization safety limit.`,
    );
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
    return { id: data.id, ...(data.html_url == null ? {} : { htmlUrl: data.html_url }) };
  }

  async updateCheckRun(
    owner: string,
    repository: string,
    checkRunId: number,
    request: GitHubCheckRunRequest,
  ): Promise<{ id: number; htmlUrl?: string }> {
    const { data } = await this.request<CheckRunResponse>(
      "PATCH",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs/${checkRunId}`,
      this.requireInstallationToken(),
      this.checkBody(request),
    );
    return { id: data.id, ...(data.html_url == null ? {} : { htmlUrl: data.html_url }) };
  }

  async findCheckRunByExternalId(
    owner: string,
    repository: string,
    headSha: string,
    externalId: string,
  ): Promise<GitHubCheckRunIdentity | null> {
    const { data } = await this.request<CheckRunsResponse>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(headSha)}/check-runs?check_name=AgentShield&filter=latest&per_page=100`,
      this.requireInstallationToken(),
    );
    const match = data.check_runs.find((checkRun) => checkRun.external_id === externalId);
    if (match == null) return null;
    if (!Number.isSafeInteger(match.id) || match.id <= 0) {
      throw new Error("GitHub returned an invalid Check run identity.");
    }
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
