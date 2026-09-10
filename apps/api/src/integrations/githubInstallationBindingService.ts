import type { PrismaClient } from "@prisma/client";

import type { GitHubAppClient } from "./githubApp.js";
import {
  registerGitHubInstallation,
  synchronizeGitHubRepositories,
} from "./githubInstallationService.js";

export interface BindGitHubInstallationInput {
  organizationId: string;
  installationId: number;
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
