import { importPKCS8, SignJWT } from "jose";

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

export interface GitHubApiClientOptions {
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
  apiVersion?: string;
  now?: () => number;
  installationToken?: string;
}

export class FetchGitHubAppClient implements GitHubAppClient, GitHubChecksClient {
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

  private async createAppJwt(): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1_000) - 60;
    const key = await importPKCS8(this.config.privateKey, "RS256");
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
      if (pageItems.length < 100) break;
    }
    return repositories;
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
