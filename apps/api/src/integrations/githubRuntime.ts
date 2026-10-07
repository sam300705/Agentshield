import type { PrismaClient } from "@prisma/client";
import { getRuntimeConfig } from "../config.js";
import { FetchGitHubAppClient } from "./githubApiClient.js";
import {
  GitHubRepositoryMaterializer,
  type GitHubRepositoryBindingResolver,
} from "./githubRepositoryMaterializer.js";
import { TemporaryRepositoryWorkspaceProvider } from "../services/repositoryWorkspace.js";
import { ConfiguredScanJobExecutor } from "../services/scanJobExecutor.js";
import { publishGitHubChecks } from "./githubCheckPublisher.js";

export function githubBindingResolver(client: PrismaClient): GitHubRepositoryBindingResolver {
  return {
    async resolve(organizationId, repositoryId) {
      const repository = await client.repository.findFirst({
        where: {
          id: repositoryId,
          organizationId,
          provider: "GITHUB",
          githubAccessible: true,
          githubInstallation: { organizationId, status: "ACTIVE" },
        },
        include: { githubInstallation: true },
      });
      if (repository?.githubInstallation == null) return null;
      return {
        organizationId,
        repositoryId,
        fullName: repository.fullName,
        externalId: repository.externalId,
        installationId: repository.githubInstallation.installationId,
      };
    },
  };
}

export function githubClientFromEnvironment(): FetchGitHubAppClient {
  const config = getRuntimeConfig();
  if (
    !config.githubMaterializationEnabled ||
    config.GITHUB_APP_ID == null ||
    config.GITHUB_PRIVATE_KEY == null
  )
    throw new Error("GITHUB_LIVE_CONFIGURATION_REQUIRED");
  return new FetchGitHubAppClient({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
    webhookSecret: config.GITHUB_WEBHOOK_SECRET ?? "",
  });
}

export function createGitHubExecutor(client: PrismaClient, github: FetchGitHubAppClient) {
  const executor = new ConfiguredScanJobExecutor(
    new TemporaryRepositoryWorkspaceProvider(
      new GitHubRepositoryMaterializer({
        enabled: true,
        archiveClient: github,
        bindingResolver: githubBindingResolver(client),
        tokenProvider: {
          async getInstallationToken(installationId) {
            const installation = await client.gitHubInstallation.findFirst({
              where: { installationId, status: "ACTIVE" },
            });
            if (installation == null) throw new Error("GITHUB_INSTALLATION_UNAVAILABLE");
            return (await github.createInstallationToken(installationId)).token;
          },
        },
      }),
    ),
  );
  return {
    async execute(input: Parameters<typeof executor.execute>[0]) {
      // Publication reads only durable state. Scan attempts never publish their own output.
      await publishGitHubChecks(client, github, input.scanId);
      return executor.execute(input);
    },
  };
}
