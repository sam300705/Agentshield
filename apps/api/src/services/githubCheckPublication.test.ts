import { ScanStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { GitHubChecksClient } from "../integrations/githubChecks.js";
import {
  calculateGitHubCheckRetryDelayMs,
  discoverGitHubCheckPublications,
  processNextGitHubCheckPublication,
  type GitHubCheckAppClient,
} from "./githubCheckPublication.js";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

function databaseForPublication() {
  const publicationUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
  const publicationFindMany = vi.fn(() =>
    Promise.resolve([
      {
        id: "publication-1",
        scanId: "scan-1",
        organizationId: "org-1",
        status: "PENDING",
        attempts: 0,
        maxAttempts: 6,
        createdAt: new Date("2026-09-11T00:00:00Z"),
      },
    ]),
  );
  const publicationFindUniqueOrThrow = vi.fn(() =>
    Promise.resolve({
      id: "publication-1",
      scanId: "scan-1",
      organizationId: "org-1",
      status: "RUNNING",
      attempts: 1,
      maxAttempts: 6,
      checkRunId: null,
    }),
  );
  const scanFindMany = vi.fn(() => Promise.resolve([]));
  const scanFindUniqueOrThrow = vi.fn(() =>
    Promise.resolve({
      id: "scan-1",
      status: ScanStatus.COMPLETED,
      organizationId: "org-1",
      commitSha: COMMIT_SHA,
      startedAt: new Date("2026-09-11T00:00:00Z"),
      completedAt: new Date("2026-09-11T00:01:00Z"),
      receipt: {
        findingCounts: { CRITICAL: 1, HIGH: 2 },
        gateResult: "BLOCK",
        policyBundleVersion: "production@2.4.0",
      },
      repository: {
        organizationId: "org-1",
        provider: "GITHUB",
        fullName: "acme/project",
        githubInstallation: {
          installationId: 42,
          status: "ACTIVE",
          permissions: { checks: "write", contents: "read" },
        },
      },
    }),
  );
  const client = {
    scan: { findMany: scanFindMany, findUniqueOrThrow: scanFindUniqueOrThrow },
    gitHubCheckPublication: {
      createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      updateMany: publicationUpdateMany,
      findMany: publicationFindMany,
      findUniqueOrThrow: publicationFindUniqueOrThrow,
    },
  } as unknown as PrismaClient;
  return { client, publicationUpdateMany };
}

describe("GitHub Check publication queue", () => {
  it("uses bounded exponential retry delay", () => {
    expect(calculateGitHubCheckRetryDelayMs(1, () => 0)).toBe(2_000);
    expect(calculateGitHubCheckRetryDelayMs(2, () => 0)).toBe(4_000);
    expect(calculateGitHubCheckRetryDelayMs(100, () => 0.99)).toBeLessThanOrEqual(300_000);
  });

  it("creates durable publication rows only for eligible completed scans", async () => {
    const createMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const client = {
      scan: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { id: "scan-1", organizationId: "org-1" },
            { id: "scan-2", organizationId: "org-1" },
          ]),
        ),
      },
      gitHubCheckPublication: { createMany },
    } as unknown as PrismaClient;

    await expect(discoverGitHubCheckPublications(client)).resolves.toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { scanId: "scan-1", organizationId: "org-1" },
        { scanId: "scan-2", organizationId: "org-1" },
      ],
      skipDuplicates: true,
    });
  });

  it("reconciles an existing external-id Check instead of creating a duplicate", async () => {
    const database = databaseForPublication();
    const findCheckRunByExternalId = vi.fn(() =>
      Promise.resolve({ id: 88, externalId: "agentshield:scan:scan-1" }),
    );
    const createCheckRun = vi.fn();
    const updateCheckRun = vi.fn(() => Promise.resolve({ id: 88 }));
    const checksClient: GitHubChecksClient = {
      findCheckRunByExternalId,
      createCheckRun,
      updateCheckRun,
    };
    const appClient: GitHubCheckAppClient = {
      createInstallationToken: vi.fn(() =>
        Promise.resolve({ token: "installation-token", expiresAt: new Date("2030-01-01T00:00:00Z") }),
      ),
      withInstallationToken: vi.fn(() => checksClient),
    };

    await expect(
      processNextGitHubCheckPublication(
        database.client,
        appClient,
        "publisher-1",
        "https://dashboard.example.test",
      ),
    ).resolves.toBe(true);

    expect(findCheckRunByExternalId).toHaveBeenCalledWith(
      "acme",
      "project",
      COMMIT_SHA,
      "agentshield:scan:scan-1",
    );
    expect(createCheckRun).not.toHaveBeenCalled();
    expect(updateCheckRun).toHaveBeenCalledWith(
      "acme",
      "project",
      88,
      expect.objectContaining({
        externalId: "agentshield:scan:scan-1",
        conclusion: "failure",
      }),
    );
    expect(database.publicationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PUBLISHED", checkRunId: "88" }),
      }),
    );
  });
});
