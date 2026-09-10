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
