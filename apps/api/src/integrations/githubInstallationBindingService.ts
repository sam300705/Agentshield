import type { PrismaClient } from "@prisma/client";

import type { GitHubAppClient } from "./githubApp.js";
import {
  registerGitHubInstallation,
  synchronizeGitHubRepositories,
} from "./githubInstallationService.js";

export interface BindGitHubInstallationInput {
  organizationId: string;
  installationId: number;
  requireChecksWrite?: boolean;
}

function canReadContents(permission: string | undefined): boolean {
  return permission === "read" || permission === "write";
}

export async function bindAndSynchronizeGitHubInstallation(
  client: PrismaClient,
  githubClient: GitHubAppClient,
  input: BindGitHubInstallationInput,
): Promise<{
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositoryCount: number;
}> {
  const metadata = await githubClient.getInstallation(input.installationId);
  if (metadata.installationId !== input.installationId) {
    throw new Error("GITHUB_INSTALLATION_IDENTITY_MISMATCH");
  }
  if (metadata.suspended) {
    throw new Error("GITHUB_INSTALLATION_SUSPENDED");
  }
  if (!canReadContents(metadata.permissions.contents)) {
    throw new Error("GITHUB_CONTENTS_READ_PERMISSION_REQUIRED");
  }
  if (input.requireChecksWrite === true && metadata.permissions.checks !== "write") {
    throw new Error("GITHUB_CHECKS_WRITE_PERMISSION_REQUIRED");
  }

  const registration = {
    organizationId: input.organizationId,
    installationId: metadata.installationId,
    accountLogin: metadata.accountLogin,
    accountType: metadata.accountType,
    permissions: metadata.permissions,
  };
  await registerGitHubInstallation(client, registration);
  const repositoryCount = await synchronizeGitHubRepositories(client, githubClient, registration);

  return {
    installationId: metadata.installationId,
    accountLogin: metadata.accountLogin,
    accountType: metadata.accountType,
    repositoryCount,
  };
}
