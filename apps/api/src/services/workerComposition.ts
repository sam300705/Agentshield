import type { GitHubAppConfig } from "../integrations/githubApp.js";
import {
  FetchGitHubAppClient,
  type GitHubArchiveClient,
} from "../integrations/githubApiClient.js";
import {
  GitHubRepositoryMaterializer,
  type GitHubRepositoryBindingResolver,
} from "../integrations/githubRepositoryMaterializer.js";
import { prisma } from "../db/prisma.js";
import type { RuntimeConfig } from "../config.js";
import { ConfiguredScanJobExecutor, type ScanJobExecutor } from "./scanJobExecutor.js";
import { TemporaryRepositoryWorkspaceProvider } from "./repositoryWorkspace.js";

export interface WorkerGitHubClient extends GitHubArchiveClient {
  validateAppCredentials(): Promise<void>;
  createInstallationToken(
    installationId: number,
  ): Promise<{ token: string; expiresAt: Date }>;
}

export interface WorkerCompositionDependencies {
  githubClientFactory?: (config: GitHubAppConfig) => WorkerGitHubClient;
  bindingResolver?: GitHubRepositoryBindingResolver;
  workspaceRoot?: string;
}

export class PrismaGitHubRepositoryBindingResolver implements GitHubRepositoryBindingResolver {
  async resolve(organizationId: string, repositoryId: string) {
    const repository = await prisma.repository.findFirst({
      where: {
        id: repositoryId,
        organizationId,
        provider: "GITHUB",
      },
      select: {
        id: true,
        organizationId: true,
        fullName: true,
        githubInstallation: {
          select: {
            installationId: true,
            status: true,
          },
        },
      },
    });
    if (
      repository == null ||
      repository.githubInstallation == null ||
      repository.githubInstallation.status !== "ACTIVE"
    ) {
      return null;
    }
    return {
      organizationId: repository.organizationId,
      repositoryId: repository.id,
      fullName: repository.fullName,
      installationId: repository.githubInstallation.installationId,
    };
  }
}

function requireGitHubAppConfig(config: RuntimeConfig): GitHubAppConfig {
  if (
    config.GITHUB_APP_ID == null ||
    config.GITHUB_PRIVATE_KEY == null ||
    config.GITHUB_WEBHOOK_SECRET == null
  ) {
    throw new Error("GITHUB_WORKER_CONFIGURATION_INVALID");
  }
  return {
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
    webhookSecret: config.GITHUB_WEBHOOK_SECRET,
    ...(config.GITHUB_CLIENT_ID == null ? {} : { clientId: config.GITHUB_CLIENT_ID }),
  };
}

export async function createWorkerScanExecutor(
  config: RuntimeConfig,
  dependencies: WorkerCompositionDependencies = {},
): Promise<ScanJobExecutor> {
  if (!config.githubScanLifecycleEnabled) {
    return new ConfiguredScanJobExecutor();
  }
  if (!config.githubMaterializationEnabled) {
    throw new Error("GITHUB_WORKER_MATERIALIZATION_REQUIRED");
  }

  const appConfig = requireGitHubAppConfig(config);
  const githubClient =
    dependencies.githubClientFactory?.(appConfig) ?? new FetchGitHubAppClient(appConfig);

  // This signs a JWT locally only; it performs no network request. A malformed,
  // unsupported, or unusable key therefore fails before the worker polls jobs.
  await githubClient.validateAppCredentials();

  const tokenProvider = {
    async getInstallationToken(installationId: number): Promise<string> {
      const result = await githubClient.createInstallationToken(installationId);
      if (result.token.length === 0) throw new Error("GITHUB_INSTALLATION_TOKEN_UNAVAILABLE");
      return result.token;
    },
  };
  const bindingResolver =
    dependencies.bindingResolver ?? new PrismaGitHubRepositoryBindingResolver();
  const materializer = new GitHubRepositoryMaterializer({
    enabled: true,
    archiveClient: githubClient,
    tokenProvider,
    bindingResolver,
  });
  const workspaceProvider = new TemporaryRepositoryWorkspaceProvider(
    materializer,
    dependencies.workspaceRoot,
  );
  return new ConfiguredScanJobExecutor(workspaceProvider);
}
