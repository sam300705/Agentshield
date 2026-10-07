import { describe, expect, it } from "vitest";

import { scanJobPayloadSchema } from "./scan-job.schema.js";

describe("scan job payload schema", () => {
  it("normalizes a manual provider-neutral scan request", () => {
    const payload = scanJobPayloadSchema.parse({
      organizationId: "org-1",
      repositoryId: "repo-1",
      provider: "GITHUB",
      integrationId: "123",
      repositoryName: "acme/project",
      repositoryUrl: "https://github.com/acme/project",
      ref: "refs/heads/main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      policyBundleVersion: "production@2.4.0",
      trigger: "MANUAL",
      requester: "user-1",
      correlationId: "corr-1",
      options: { includeOsv: true },
    });

    expect(payload.options).toMatchObject({
      maxFiles: 10_000,
      maxBytes: 100_000_000,
      timeoutMs: 120_000,
      includeOsv: true,
      ignorePaths: [],
    });
  });

  it("rejects unsafe or incomplete job identity", () => {
    expect(() =>
      scanJobPayloadSchema.parse({
        organizationId: "org-1",
        repositoryId: "repo-1",
        provider: "GITHUB",
        integrationId: "123",
        repositoryName: "acme/project",
        ref: "main",
        commitSha: "not-a-sha",
        policyBundleVersion: "production@2.4.0",
        trigger: "PUSH",
        requester: "user-1",
        correlationId: "corr-1",
      }),
    ).toThrow();
  });
});

it.each([undefined, "abcdef1", "0".repeat(40), "a".repeat(64)])(
  "rejects GitHub job SHA %s before materialization",
  (commitSha) => {
    expect(
      scanJobPayloadSchema.safeParse({
        organizationId: "org",
        repositoryId: "repo",
        provider: "GITHUB",
        integrationId: "123",
        repositoryName: "a/b",
        ref: "main",
        commitSha,
        policyBundleVersion: "2026.06.0",
        trigger: "MANUAL",
        requester: "user",
        correlationId: "corr",
      }).success,
    ).toBe(false);
  },
);
