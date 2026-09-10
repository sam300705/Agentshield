import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { GitHubAppClient } from "./githubApp.js";
import {
  normalizeGitHubRepository,
  registerGitHubInstallation,
  synchronizeGitHubRepositories,
} from "./githubInstallationService.js";

function registration() {
  return {
    organizationId: "org-1",
    installationId: 42,
    accountLogin: "acme",
  };
}

function repository(id: number, fullName: string) {
  return {
    id,
    fullName,
    private: true,
    defaultBranch: "main",
    permissions: { admin: true, push: true, pull: true },
  };
}

describe("GitHub repository normalization", () => {
  it("creates stable provider-neutral repository identity", () => {
    expect(
      normalizeGitHubRepository({
        id: 123,
        fullName: "acme/project",
        private: true,
        defaultBranch: null,
        permissions: { admin: true, push: true, pull: true },
      }),
    ).toEqual({
      provider: "GITHUB",
      externalId: "123",
      fullName: "acme/project",
      defaultBranch: "main",
    });
  });
});

describe("GitHub installation ownership", () => {
  it("rejects attempts to reassign an installation to another organization", async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve({ id: "installation-1", organizationId: "org-2" }),
    );
    const create = vi.fn();
    const update = vi.fn();
    const client = {
      gitHubInstallation: { findUnique, create, update },
    } as unknown as PrismaClient;

    await expect(registerGitHubInstallation(client, registration())).rejects.toThrow(
      "GitHub installation is already owned by another organization",
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("reactivates an installation only inside its existing organization", async () => {
    const findUnique = vi.fn(() =>
      Promise.resolve({ id: "installation-1", organizationId: "org-1" }),
    );
    const update = vi.fn(() =>
      Promise.resolve({ id: "installation-1", organizationId: "org-1", installationId: 42 }),
    );
    const client = {
      gitHubInstallation: { findUnique, create: vi.fn(), update },
    } as unknown as PrismaClient;

    await expect(registerGitHubInstallation(client, registration())).resolves.toEqual({
      id: "installation-1",
      organizationId: "org-1",
      installationId: 42,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "installation-1" },
        data: expect.objectContaining({ status: "ACTIVE", accountLogin: "acme" }),
      }),
    );
  });
});

describe("GitHub repository synchronization", () => {
  it("checks tenant ownership before requesting an installation token", async () => {
    const createInstallationToken = vi.fn();
    const client = {
      gitHubInstallation: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({ id: "installation-1", organizationId: "org-2", status: "ACTIVE" }),
        ),
      },
    } as unknown as PrismaClient;
    const githubClient = {
      createInstallationToken,
      listInstallationRepositories: vi.fn(),
    } as unknown as GitHubAppClient;

    await expect(
      synchronizeGitHubRepositories(client, githubClient, registration()),
    ).rejects.toThrow("GitHub installation organization ownership mismatch");
    expect(createInstallationToken).not.toHaveBeenCalled();
  });

  it("rejects inactive installations before requesting a token", async () => {
    const createInstallationToken = vi.fn();
    const client = {
      gitHubInstallation: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({ id: "installation-1", organizationId: "org-1", status: "SUSPENDED" }),
        ),
      },
    } as unknown as PrismaClient;
    const githubClient = {
      createInstallationToken,
      listInstallationRepositories: vi.fn(),
    } as unknown as GitHubAppClient;

    await expect(
      synchronizeGitHubRepositories(client, githubClient, registration()),
    ).rejects.toThrow("GitHub installation is not active");
    expect(createInstallationToken).not.toHaveBeenCalled();
  });

  it("upserts authorized repositories and detaches repositories revoked by GitHub", async () => {
    const repositoryUpsert = vi.fn(() => Promise.resolve());
    const repositoryUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const installationUpdate = vi.fn(() => Promise.resolve());
    const transaction = vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        repository: { upsert: repositoryUpsert, updateMany: repositoryUpdateMany },
        gitHubInstallation: { update: installationUpdate },
      }),
    );
    const client = {
      gitHubInstallation: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({ id: "installation-1", organizationId: "org-1", status: "ACTIVE" }),
        ),
      },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const githubClient = {
      createInstallationToken: vi.fn(() =>
        Promise.resolve({ token: "ok", expiresAt: new Date("2030-01-01T00:00:00Z") }),
      ),
      listInstallationRepositories: vi.fn(() =>
        Promise.resolve([repository(101, "acme/one"), repository(202, "acme/two")]),
      ),
    } as unknown as GitHubAppClient;

    await expect(
      synchronizeGitHubRepositories(client, githubClient, registration()),
    ).resolves.toBe(2);
    expect(repositoryUpsert).toHaveBeenCalledTimes(2);
    expect(repositoryUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        provider: "GITHUB",
        githubInstallationId: "installation-1",
        externalId: { notIn: ["101", "202"] },
      },
      data: { githubInstallationId: null },
    });
    expect(installationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "installation-1" } }),
    );
  });
});
