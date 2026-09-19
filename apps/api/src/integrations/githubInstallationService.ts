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
  const existing = await client.gitHubInstallation.findUnique({
    where: { installationId: input.installationId },
    select: { id: true, organizationId: true },
  });
  if (existing != null && existing.organizationId !== input.organizationId) {
    throw new Error("GitHub installation is already owned by another organization.");
  }

  if (existing == null) {
    return client.gitHubInstallation.create({
      data: {
        organizationId: input.organizationId,
        installationId: input.installationId,
        accountLogin: input.accountLogin,
        ...(input.accountType == null ? {} : { accountType: input.accountType }),
        ...(input.permissions == null ? {} : { permissions: input.permissions }),
      },
      select: { id: true, organizationId: true, installationId: true },
    });
  }

  return client.gitHubInstallation.update({
    where: { id: existing.id },
    data: {
      accountLogin: input.accountLogin,
      ...(input.accountType == null ? {} : { accountType: input.accountType }),
      ...(input.permissions == null ? {} : { permissions: input.permissions }),
      status: "ACTIVE",
    },
    select: { id: true, organizationId: true, installationId: true },
  });
}

export async function synchronizeGitHubRepositories(
  client: PrismaClient,
  githubClient: GitHubAppClient,
  registration: GitHubInstallationRegistration,
): Promise<number> {
  const installation = await client.gitHubInstallation.findUniqueOrThrow({
    where: { installationId: registration.installationId },
    select: { id: true, organizationId: true, status: true },
  });
  if (installation.organizationId !== registration.organizationId) {
    throw new Error("GitHub installation organization ownership mismatch.");
  }
  if (installation.status !== "ACTIVE") {
    throw new Error("GitHub installation is not active.");
  }

  const token = await githubClient.createInstallationToken(registration.installationId);
  const repositories = await githubClient.listInstallationRepositories(
    registration.installationId,
    token.token,
  );
  const externalIds = repositories.map((repository) => String(repository.id));

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

    await tx.repository.updateMany({
      where: {
        organizationId: registration.organizationId,
        provider: "GITHUB",
        githubInstallationId: installation.id,
        ...(externalIds.length === 0 ? {} : { externalId: { notIn: externalIds } }),
      },
      data: { githubInstallationId: null },
    });
    await tx.gitHubInstallation.update({
      where: { id: installation.id },
      data: { lastSyncedAt: new Date() },
    });
  });
  return repositories.length;
}
