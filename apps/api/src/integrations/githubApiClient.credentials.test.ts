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

function rsaPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
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
    await expect(
      new FetchGitHubAppClient(appConfig(rsaPem())).validateAppCredentials(),
    ).resolves.toBe(undefined);
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

describe("FetchGitHubAppClient installation verification", () => {
  it("loads canonical installation identity using an App JWT", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      requestedUrls.push(requestUrl(input));
      const authorization = new Headers(init?.headers).get("authorization");
      expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 42,
            account: { login: "verified-org", type: "Organization" },
            permissions: { checks: "write", contents: "read", invalid: 123 },
            suspended_at: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };
    const client = new FetchGitHubAppClient(appConfig(rsaPem()), { fetchImpl });

    await expect(client.getInstallation(42)).resolves.toEqual({
      installationId: 42,
      accountLogin: "verified-org",
      accountType: "Organization",
      permissions: { checks: "write", contents: "read" },
      suspended: false,
    });
    expect(requestedUrls).toEqual(["https://api.github.com/app/installations/42"]);
  });

  it("rejects inconsistent installation identity returned by GitHub", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 99,
            account: { login: "verified-org", type: "Organization" },
            permissions: {},
            suspended_at: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const client = new FetchGitHubAppClient(appConfig(rsaPem()), { fetchImpl });

    await expect(client.getInstallation(42)).rejects.toThrow(
      "GitHub returned invalid installation metadata",
    );
  });
});

describe("FetchGitHubAppClient repository pagination", () => {
  it("collects repositories across multiple pages", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = () => {
      requests += 1;
      const payload = requests === 1 ? repositoryPage(1, 100) : repositoryPage(101, 50);
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    const client = new FetchGitHubAppClient(appConfig("unused"), { fetchImpl });

    await expect(client.listInstallationRepositories(42, "x")).resolves.toHaveLength(150);
    expect(requests).toBe(2);
  });

  it("fails closed instead of silently truncating an oversized installation", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = () => {
      requests += 1;
      return Promise.resolve(
        new Response(JSON.stringify(repositoryPage(requests * 100, 100)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    const client = new FetchGitHubAppClient(appConfig("unused"), { fetchImpl });

    await expect(client.listInstallationRepositories(42, "x")).rejects.toThrow(
      "repository list exceeded the synchronization safety limit",
    );
    expect(requests).toBe(100);
  });
});
