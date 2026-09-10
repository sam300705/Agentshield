import { describe, expect, it } from "vitest";

import { scanJobPayloadSchema } from "./scan-job.schema.js";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

function githubPayload(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    integrationId: "42",
    repositoryId: "repo-1",
    provider: "GITHUB",
    repositoryName: "acme/project",
    repositoryUrl: "https://github.com/acme/project",
    ref: "refs/heads/main",
    commitSha,
    policyBundleVersion: "production@2.4.0",
    trigger: "MANUAL",
    github: {
      installationId: 42,
      repositoryFullName: "acme/project",
    },
    requester: "user-1",
    correlationId: "corr-1",
    options: { includeOsv: true },
    ...overrides,
  };
}

describe("scan job payload schema", () => {
  it("accepts a manual GitHub scan with trusted target lineage but no webhook provenance", () => {
    const payload = scanJobPayloadSchema.parse(githubPayload());

    expect(payload.trigger).toBe("MANUAL");
    expect(payload.github).toEqual({
      installationId: 42,
      repositoryFullName: "acme/project",
    });
    expect(payload.options).toMatchObject({
      maxFiles: 10_000,
      maxBytes: 100_000_000,
      timeoutMs: 120_000,
      includeOsv: true,
      ignorePaths: [],
    });
  });

  it("accepts an API GitHub scan with trusted target lineage", () => {
    expect(scanJobPayloadSchema.parse(githubPayload({ trigger: "API" })).trigger).toBe("API");
  });

  it.each([
    ["PUSH", "push"],
    ["PULL_REQUEST", "pull_request"],
    ["INSTALLATION", "installation"],
  ] as const)("accepts %s with matching webhook provenance", (trigger, eventName) => {
    const payload = scanJobPayloadSchema.parse(
      githubPayload({
        trigger,
        github: {
          installationId: 42,
          repositoryFullName: "acme/project",
          deliveryId: "delivery-1",
          eventName,
          action: trigger === "PUSH" ? undefined : "opened",
        },
      }),
    );
    expect(payload.trigger).toBe(trigger);
  });

  it.each(["PUSH", "PULL_REQUEST", "INSTALLATION"] as const)(
    "rejects %s without webhook provenance",
    (trigger) => {
      expect(() => scanJobPayloadSchema.parse(githubPayload({ trigger }))).toThrow(
        "Webhook-triggered scans require delivery and event provenance",
      );
    },
  );

  it.each([
    ["PUSH", "pull_request"],
    ["PULL_REQUEST", "push"],
    ["INSTALLATION", "push"],
  ] as const)("rejects %s with mismatched event %s", (trigger, eventName) => {
    expect(() =>
      scanJobPayloadSchema.parse(
        githubPayload({
          trigger,
          github: {
            installationId: 42,
            repositoryFullName: "acme/project",
            deliveryId: "delivery-1",
            eventName,
          },
        }),
      ),
    ).toThrow("GitHub webhook event does not match the trusted scan trigger");
  });

  it.each(["MANUAL", "API"] as const)(
    "rejects webhook provenance on %s scans",
    (trigger) => {
      expect(() =>
        scanJobPayloadSchema.parse(
          githubPayload({
            trigger,
            github: {
              installationId: 42,
              repositoryFullName: "acme/project",
              deliveryId: "delivery-1",
              eventName: "push",
            },
          }),
        ),
      ).toThrow("Manual/API scans cannot claim webhook delivery provenance");
    },
  );

  it("rejects GitHub scans without target lineage", () => {
    expect(() =>
      scanJobPayloadSchema.parse({
        ...githubPayload(),
        github: undefined,
        integrationId: undefined,
      }),
    ).toThrow("GitHub provider scans require trusted GitHub lineage");
  });

  it("rejects mismatched transitional integration identity", () => {
    expect(() => scanJobPayloadSchema.parse(githubPayload({ integrationId: "99" }))).toThrow(
      "GitHub integration identity must match trusted installation lineage",
    );
  });

  it("rejects mismatched repository identity", () => {
    expect(() =>
      scanJobPayloadSchema.parse(
        githubPayload({
          github: { installationId: 42, repositoryFullName: "other/project" },
        }),
      ),
    ).toThrow("GitHub lineage repository must match the registered repository name");
  });

  it("rejects short or malformed commit SHAs for GitHub materialization", () => {
    expect(() => scanJobPayloadSchema.parse(githubPayload({ commitSha: "abcdef1" }))).toThrow(
      "GitHub provider scans require an immutable 40-character commit SHA",
    );
  });

  it("rejects GitHub lineage on LOCAL scans", () => {
    expect(() =>
      scanJobPayloadSchema.parse({
        ...githubPayload(),
        provider: "LOCAL",
      }),
    ).toThrow("Non-GitHub scans cannot carry GitHub lineage");
  });

  it("accepts a provider-neutral local manual scan", () => {
    expect(
      scanJobPayloadSchema.parse({
        organizationId: "org-1",
        repositoryId: "repo-local",
        provider: "LOCAL",
        repositoryName: "local/project",
        ref: "main",
        policyBundleVersion: "production@2.4.0",
        trigger: "MANUAL",
        requester: "user-1",
        correlationId: "corr-1",
      }).provider,
    ).toBe("LOCAL");
  });
});
