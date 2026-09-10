import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { GitHubAppClient } from "./githubApp.js";
import { bindAndSynchronizeGitHubInstallation } from "./githubInstallationBindingService.js";

const installationMetadata = {
  installationId: 42,
  accountLogin: "verified-org",
  accountType: "Organization",
  permissions: { checks: "write", contents: "read" },
  suspended: false,
};

function githubClient(overrides: Partial<GitHubAppClient> = {}): GitHubAppClient {
  return {
    getInstallation: vi.fn(() => Promise.resolve(installationMetadata)),
    createInstallationToken: vi.fn(() =>
      Promise.resolve({ token: "ok", expiresAt: new Date("2030-01-01T00:00:00Z") }),
    ),
    listInstallationRepositories: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
}

function prismaClient() {
  const create = vi.fn(() =>
    Promise.resolve({ id: "install-row", organizationId: "org-1", installationId: 42 }),
  );
  const findUnique = vi.fn(() => Promise.resolve(null));
  const findUniqueOrThrow = vi.fn(() =>
    Promise.resolve({ id: "install-row", organizationId: "org-1", status: "ACTIVE" }),
  );
  const repositoryUpdateMany = vi.fn(() => Promise.resolve({ count: 0 }));
  const installationUpdate = vi.fn(() => Promise.resolve());
  const transaction = vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      repository: { upsert: vi.fn(), updateMany: repositoryUpdateMany },
      gitHubInstallation: { update: installationUpdate },
    }),
  );
  const client = {
    gitHubInstallation: { create, findUnique, findUniqueOrThrow, update: vi.fn() },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return { client, create, repositoryUpdateMany };
}

describe("bindAndSynchronizeGitHubInstallation", () => {
  it("binds only the identity verified by GitHub App authentication", async () => {
    const database = prismaClient();
    const github = githubClient();

    await expect(
      bindAndSynchronizeGitHubInstallation(database.client, github, {
        organizationId: "org-1",
        installationId: 42,
      }),
    ).resolves.toEqual({
      installationId: 42,
      accountLogin: "verified-org",
      accountType: "Organization",
      repositoryCount: 0,
    });
    expect(database.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organizationId: "org-1",
          installationId: 42,
          accountLogin: "verified-org",
          accountType: "Organization",
          permissions: { checks: "write", contents: "read" },
        },
      }),
    );
  });

  it("rejects a suspended installation before persistence or token creation", async () => {
    const database = prismaClient();
    const createInstallationToken = vi.fn();
    const github = githubClient({
      getInstallation: vi.fn(() => Promise.resolve({ ...installationMetadata, suspended: true })),
      createInstallationToken,
    });

    await expect(
      bindAndSynchronizeGitHubInstallation(database.client, github, {
        organizationId: "org-1",
        installationId: 42,
      }),
    ).rejects.toThrow("GITHUB_INSTALLATION_SUSPENDED");
    expect(database.create).not.toHaveBeenCalled();
    expect(createInstallationToken).not.toHaveBeenCalled();
  });

  it("rejects a GitHub response for a different installation id", async () => {
    const database = prismaClient();
    const github = githubClient({
      getInstallation: vi.fn(() =>
        Promise.resolve({ ...installationMetadata, installationId: 99 }),
      ),
    });

    await expect(
      bindAndSynchronizeGitHubInstallation(database.client, github, {
        organizationId: "org-1",
        installationId: 42,
      }),
    ).rejects.toThrow("GITHUB_INSTALLATION_IDENTITY_MISMATCH");
    expect(database.create).not.toHaveBeenCalled();
  });
});
