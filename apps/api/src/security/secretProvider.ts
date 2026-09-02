import type { SecretReference } from "@agentshield/schemas";

export interface SecretProvider {
  resolve(reference: SecretReference): Promise<string | null>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  resolve(reference: SecretReference): Promise<string | null> {
    if (reference.provider !== "ENVIRONMENT") {
      return Promise.reject(new Error("External secret provider is not configured."));
    }
    return Promise.resolve(this.environment[reference.secretRef] ?? null);
  }
}

export class UnconfiguredSecretProvider implements SecretProvider {
  resolve(reference: SecretReference): Promise<string | null> {
    void reference;
    return Promise.reject(new Error("Secret provider is not configured."));
  }
}
