import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { GitHubAppConfig } from "./githubApp.js";
import { FetchGitHubAppClient } from "./githubApiClient.js";

function appConfig(privateKey: string): GitHubAppConfig {
  return {
    appId: "123456",
    privateKey,
    webhookSecret: "test-webhook-secret",
  };
}

function repositoryPage(start: number, count: number) {
  return {
    repositories: Array.from({ length: count }, (_, index) => ({
      id: start + index,
      full_name: `acme/repository-${start + index}`,
      private: true,
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true },
    })),
  };
}

describe("FetchGitHubAppClient credential validation", () => {
  it("accepts a real RSA private key by signing an RS256 JWT locally", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    await expect(new FetchGitHubAppClient(appConfig(pem)).validateAppCredentials()).resolves.toBe(
      undefined,
    );
  });

  it("rejects a syntactically PEM-looking value that is not a usable private key", async () => {
    const fakePem = [
      "-----BEGIN PRIVATE KEY-----",
      "ZmFrZS1rZXk=",
      "-----END PRIVATE KEY-----",
    ].join("\n");

    await expect(
      new FetchGitHubAppClient(appConfig(fakePem)).validateAppCredentials(),
    ).rejects.toThrow("GitHub App private key is not a valid RSA private key");
  });

  it("rejects a valid non-RSA private key", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    await expect(new FetchGitHubAppClient(appConfig(pem)).validateAppCredentials()).rejects.toThrow(
      "GitHub App private key must be an RSA private key",
    );
  });
});

describe("FetchGitHubAppClient repository pagination", () => {
  it("collects repositories across multiple pages", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      const payload = requests === 1 ? repositoryPage(1, 100) : repositoryPage(101, 50);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new FetchGitHubAppClient(appConfig("unused"), { fetchImpl });

    await expect(client.listInstallationRepositories(42, "x")).resolves.toHaveLength(150);
    expect(requests).toBe(2);
  });

  it("fails closed instead of silently truncating an oversized installation", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify(repositoryPage(requests * 100, 100)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new FetchGitHubAppClient(appConfig("unused"), { fetchImpl });

    await expect(client.listInstallationRepositories(42, "x")).rejects.toThrow(
      "repository list exceeded the synchronization safety limit",
    );
    expect(requests).toBe(100);
  });
});
