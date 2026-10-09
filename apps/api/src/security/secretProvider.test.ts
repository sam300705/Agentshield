import { describe, expect, it } from "vitest";

import { EnvironmentSecretProvider, UnconfiguredSecretProvider } from "./secretProvider.js";

describe("secret providers", () => {
  it("resolves only explicitly referenced environment values", async () => {
    const provider = new EnvironmentSecretProvider({ TEST_SECRET: "synthetic-value" });
    await expect(
      provider.resolve({ provider: "ENVIRONMENT", secretRef: "TEST_SECRET" }),
    ).resolves.toBe("synthetic-value");
    await expect(
      provider.resolve({ provider: "ENVIRONMENT", secretRef: "MISSING_SECRET" }),
    ).resolves.toBeNull();
  });

  it("fails closed for external providers until an adapter is configured", async () => {
    const provider = new EnvironmentSecretProvider({});
    await expect(
      provider.resolve({ provider: "AWS_SECRETS_MANAGER", secretRef: "synthetic/ref" }),
    ).rejects.toThrow("External secret provider is not configured.");
    await expect(
      new UnconfiguredSecretProvider().resolve({
        provider: "GCP_SECRET_MANAGER",
        secretRef: "synthetic/ref",
      }),
    ).rejects.toThrow("Secret provider is not configured.");
  });
});
