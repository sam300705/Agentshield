import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig, type RuntimeConfig } from "../config.js";
import { ConfiguredScanJobExecutor } from "./scanJobExecutor.js";
import { createWorkerScanExecutor, type WorkerGitHubClient } from "./workerComposition.js";

const fakePrivateKey = [
  "-----BEGIN PRIVATE KEY-----",
  "ZmFrZS1rZXk=",
  "-----END PRIVATE KEY-----",
].join("\n");

function config(overrides: NodeJS.ProcessEnv = {}): RuntimeConfig {
  return getRuntimeConfig({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://agentshield:test@localhost:5432/agentshield",
    AUTH_MODE: "demo",
    DEMO_AUTH_ENABLED: "true",
    ...overrides,
  });
}

function githubLifecycleConfig(overrides: NodeJS.ProcessEnv = {}): RuntimeConfig {
  return config({
    GITHUB_WEBHOOK_ENABLED: "true",
    GITHUB_SCAN_LIFECYCLE_ENABLED: "true",
    GITHUB_MATERIALIZATION_ENABLED: "true",
    GITHUB_APP_ID: "123456",
    GITHUB_PRIVATE_KEY: fakePrivateKey,
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    GITHUB_SCAN_POLICY_BUNDLE_VERSION: "policy-v1",
    ...overrides,
  });
}

function fakeGitHubClient() {
  const validateAppCredentials = vi.fn(() => Promise.resolve());
  const createInstallationToken = vi.fn(() =>
    Promise.resolve({ token: "test", expiresAt: new Date("2030-01-01T00:00:00Z") }),
  );
  const downloadRepositoryArchive = vi.fn(() =>
    Promise.reject(new Error("archive download should not run during composition")),
  );
  const client: WorkerGitHubClient = {
    validateAppCredentials,
    createInstallationToken,
    downloadRepositoryArchive,
  };
  return { client, validateAppCredentials, createInstallationToken, downloadRepositoryArchive };
}

describe("createWorkerScanExecutor", () => {
  it("keeps local-only workers available when GitHub lifecycle is disabled", async () => {
    await expect(createWorkerScanExecutor(config())).resolves.toBeInstanceOf(
      ConfiguredScanJobExecutor,
    );
  });

  it("fails closed when GitHub lifecycle is enabled without materialization", async () => {
    await expect(
      createWorkerScanExecutor(
        githubLifecycleConfig({
          GITHUB_MATERIALIZATION_ENABLED: "false",
        }),
      ),
    ).rejects.toThrow("GITHUB_WORKER_MATERIALIZATION_REQUIRED");
  });

  it("validates GitHub App credentials before returning a configured executor", async () => {
    const fake = fakeGitHubClient();
    const githubClientFactory = vi.fn(() => fake.client);

    await expect(
      createWorkerScanExecutor(githubLifecycleConfig(), {
        githubClientFactory,
        bindingResolver: { resolve: vi.fn(() => Promise.resolve(null)) },
      }),
    ).resolves.toBeInstanceOf(ConfiguredScanJobExecutor);

    expect(githubClientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "123456",
        webhookSecret: "test-webhook-secret",
      }),
    );
    expect(fake.validateAppCredentials).toHaveBeenCalledOnce();
    expect(fake.createInstallationToken).not.toHaveBeenCalled();
    expect(fake.downloadRepositoryArchive).not.toHaveBeenCalled();
  });

  it("does not start with credentials that fail local validation", async () => {
    const fake = fakeGitHubClient();
    fake.validateAppCredentials.mockRejectedValueOnce(new Error("invalid GitHub App key"));

    await expect(
      createWorkerScanExecutor(githubLifecycleConfig(), {
        githubClientFactory: () => fake.client,
      }),
    ).rejects.toThrow("invalid GitHub App key");
  });
});
