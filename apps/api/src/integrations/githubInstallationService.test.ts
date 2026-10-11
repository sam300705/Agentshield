import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";
import {
  normalizeGitHubRepository,
  registerGitHubInstallation,
  synchronizeGitHubRepositories,
} from "./githubInstallationService.js";

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

it("does not write repository rows or a success timestamp after incomplete synchronization", async () => {
  const transaction = vi.fn();
  const lookup = vi.fn();
  const client = {
    $transaction: transaction,
    gitHubInstallation: { findUniqueOrThrow: lookup },
  } as unknown as PrismaClient;
  const github = {
    createInstallationToken: () => Promise.resolve({ token: "synthetic", expiresAt: new Date() }),
    listInstallationRepositories: () =>
      Promise.reject(new Error("GITHUB_REPOSITORY_LIMIT_EXCEEDED")),
  };
  await expect(
    synchronizeGitHubRepositories(client, github, {
      organizationId: "org",
      installationId: 1,
      accountLogin: "synthetic",
    }),
  ).rejects.toThrow("GITHUB_REPOSITORY_LIMIT_EXCEEDED");
  expect(transaction).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
});

it("refuses cross-organization re-registration without changing installation metadata", async () => {
  const upsert = vi.fn().mockResolvedValue({
    id: "install-1",
    installationId: 42,
    organizationId: "original-org",
  });
  const updateMany = vi.fn();
  const client = {
    gitHubInstallation: { upsert, updateMany },
  } as unknown as PrismaClient;
  const registration = { organizationId: "other-org", installationId: 42, accountLogin: "attacker" };
  await expect(registerGitHubInstallation(client, registration)).rejects.toThrow(
    "GITHUB_INSTALLATION_ORGANIZATION_MISMATCH",
  );
  expect(updateMany).not.toHaveBeenCalled();
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({ update: {} }),
  );
});

it("allows same-organization installation metadata refresh", async () => {
  const row = { id: "install-1", installationId: 42, organizationId: "original-org" };
  const upsert = vi.fn().mockResolvedValue(row);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const client = { gitHubInstallation: { upsert, updateMany } } as unknown as PrismaClient;
  await expect(registerGitHubInstallation(client, {
    organizationId: "original-org", installationId: 42, accountLogin: "owner",
  })).resolves.toEqual(row);
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: "install-1", organizationId: "original-org" },
    data: { accountLogin: "owner", status: "ACTIVE" },
  });
});
