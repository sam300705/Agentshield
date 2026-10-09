import type { PrismaClient } from "@prisma/client";

import type { GitHubAppClient, GitHubRepository } from "./githubApp.js";

export interface GitHubInstallationRegistration {
  organizationId: string;
  installationId: number;
  accountLogin: string;
  accountType?: string;
  permissions?: Record<string, string>;
}

export function normalizeGitHubRepository(repository: GitHubRepository): {
  provider: "GITHUB";
  externalId: string;
  fullName: string;
  defaultBranch: string;
} {
  return {
    provider: "GITHUB",
    externalId: String(repository.id),
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch ?? "main",
  };
}

export async function registerGitHubInstallation(
  client: PrismaClient,
  input: GitHubInstallationRegistration,
): Promise<{ id: string; organizationId: string; installationId: number }> {
  const installation = await client.gitHubInstallation.upsert({
    where: { installationId: input.installationId },
    update: {
      organizationId: input.organizationId,
      accountLogin: input.accountLogin,
      ...(input.accountType == null ? {} : { accountType: input.accountType }),
      ...(input.permissions == null ? {} : { permissions: input.permissions }),
      status: "ACTIVE",
    },
    create: {
      organizationId: input.organizationId,
      installationId: input.installationId,
      accountLogin: input.accountLogin,
      ...(input.accountType == null ? {} : { accountType: input.accountType }),
      ...(input.permissions == null ? {} : { permissions: input.permissions }),
    },
    select: { id: true, organizationId: true, installationId: true },
  });
  return installation;
}

export async function synchronizeGitHubRepositories(
  client: PrismaClient,
  githubClient: GitHubAppClient,
  registration: GitHubInstallationRegistration,
): Promise<number> {
  const token = await githubClient.createInstallationToken(registration.installationId);
  const repositories = await githubClient.listInstallationRepositories(
    registration.installationId,
    token.token,
  );
  const installation = await client.gitHubInstallation.findUniqueOrThrow({
    where: { installationId: registration.installationId },
    select: { id: true, organizationId: true },
  });
  if (installation.organizationId !== registration.organizationId) {
    throw new Error("GitHub installation organization ownership mismatch.");
  }

  await client.$transaction(async (tx) => {
    for (const repository of repositories) {
      const normalized = normalizeGitHubRepository(repository);
      await tx.repository.upsert({
        where: {
          organizationId_provider_externalId: {
            organizationId: registration.organizationId,
            provider: normalized.provider,
            externalId: normalized.externalId,
          },
        },
        update: {
          fullName: normalized.fullName,
          defaultBranch: normalized.defaultBranch,
          githubInstallationId: installation.id,
        },
        create: {
          organizationId: registration.organizationId,
          provider: normalized.provider,
          externalId: normalized.externalId,
          fullName: normalized.fullName,
          defaultBranch: normalized.defaultBranch,
          githubInstallationId: installation.id,
        },
      });
    }
    await tx.gitHubInstallation.update({
      where: { id: installation.id },
      data: { lastSyncedAt: new Date() },
    });
  });
  return repositories.length;
}
