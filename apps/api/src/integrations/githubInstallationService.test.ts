import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";
import {
  normalizeGitHubRepository,
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
