import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { GitHubAppClient, GitHubRepository, VerifiedGitHubWebhook } from "./githubApp.js";

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
  });
  if (existing != null && existing.organizationId !== input.organizationId)
    throw new Error("GITHUB_INSTALLATION_ALREADY_BOUND");
  const installation = await client.gitHubInstallation.upsert({
    where: { installationId: input.installationId, organizationId: input.organizationId },
    update: {
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
  const binding = await client.gitHubInstallation.findFirst({
    where: {
      installationId: registration.installationId,
      organizationId: registration.organizationId,
      status: "ACTIVE",
    },
  });
  if (binding == null) throw new Error("GITHUB_INSTALLATION_UNAVAILABLE");
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
    await tx.repository.updateMany({
      where: { organizationId: registration.organizationId, githubInstallationId: installation.id },
      data: { githubAccessible: false },
    });
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
          githubAccessible: true,
          fullName: normalized.fullName,
          defaultBranch: normalized.defaultBranch,
          githubInstallationId: installation.id,
        },
        create: {
          organizationId: registration.organizationId,
          provider: normalized.provider,
          externalId: normalized.externalId,
          githubAccessible: true,
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

export async function applyGitHubInstallationEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  webhook: VerifiedGitHubWebhook,
  correlationId: string,
): Promise<void> {
  const installation = await tx.gitHubInstallation.findFirstOrThrow({
    where: { organizationId, installationId: webhook.installationId },
  });
  const statuses: Record<string, string> = {
    created: "ACTIVE",
    deleted: "DELETED",
    suspend: "SUSPENDED",
    unsuspend: "ACTIVE",
  };
  const status = webhook.eventName === "installation" ? statuses[webhook.action ?? ""] : undefined;
  if (installation.status === "DELETED" && webhook.action !== "created") return;
  if (status != null)
    await tx.gitHubInstallation.update({ where: { id: installation.id }, data: { status } });
  if (status === "DELETED")
    await tx.repository.updateMany({
      where: { githubInstallationId: installation.id, organizationId },
      data: { githubAccessible: false },
    });
  const selected =
    webhook.eventName === "installation_repositories"
      ? webhook.payload.repositories_added
      : webhook.action === "created"
        ? webhook.payload.repositories
        : [];
  const removed = z
    .array(z.object({ id: z.number().int().positive() }))
    .max(10_000)
    .parse(webhook.payload.repositories_removed ?? []);
  for (const value of removed) {
    await tx.repository.updateMany({
      where: {
        organizationId,
        githubInstallationId: installation.id,
        externalId: String(value.id),
      },
      data: { githubAccessible: false },
    });
  }
  if ((status ?? installation.status) === "ACTIVE") {
    const repositories = z
      .array(
        z.object({
          id: z.number().int().positive(),
          full_name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
        }),
      )
      .max(10_000)
      .parse(selected ?? []);
    for (const value of repositories) {
      await tx.repository.upsert({
        where: {
          organizationId_provider_externalId: {
            organizationId,
            provider: "GITHUB",
            externalId: String(value.id),
          },
        },
        create: {
          organizationId,
          provider: "GITHUB",
          externalId: String(value.id),
          fullName: value.full_name,
          defaultBranch: "main",
          githubInstallationId: installation.id,
        },
        update: {
          fullName: value.full_name,
          githubInstallationId: installation.id,
          githubAccessible: true,
        },
      });
    }
  }
  await tx.auditEvent.create({
    data: {
      organizationId,
      actor: "github:webhook",
      action: "GITHUB_INSTALLATION_UPDATED",
      entityType: "GitHubInstallation",
      entityId: installation.id,
      correlationId,
      metadata: {
        deliveryId: webhook.deliveryId,
        installationId: webhook.installationId,
        event: webhook.eventName,
        action: webhook.action,
        status: status ?? installation.status,
      },
    },
  });
}
