import { ScanStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { GitHubChecksClient } from "../integrations/githubChecks.js";
import {
  calculateGitHubCheckRetryDelayMs,
  classifyAbandonedGitHubCheckPublication,
  discoverGitHubCheckPublications,
  processNextGitHubCheckPublication,
  type GitHubCheckAppClient,
} from "./githubCheckPublication.js";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error("Expected an object record.");
  }
  return value as Record<string, unknown>;
}

function databaseForPublication() {
  const publicationUpdates: unknown[] = [];
  const publicationUpdateMany = vi.fn((input: unknown) => {
    publicationUpdates.push(input);
    return Promise.resolve({ count: 1 });
  });
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
  return { client, publicationUpdates };
}

describe("GitHub Check publication queue", () => {
  it("uses bounded exponential retry delay", () => {
    expect(calculateGitHubCheckRetryDelayMs(1, () => 0)).toBe(2_000);
    expect(calculateGitHubCheckRetryDelayMs(2, () => 0)).toBe(4_000);
    expect(calculateGitHubCheckRetryDelayMs(100, () => 0.99)).toBeLessThanOrEqual(300_000);
  });

  it("dead-letters an abandoned final publication attempt", () => {
    expect(classifyAbandonedGitHubCheckPublication({ attempts: 6, maxAttempts: 6 })).toBe(
      "DEAD_LETTER",
    );
    expect(classifyAbandonedGitHubCheckPublication({ attempts: 5, maxAttempts: 6 })).toBe("RETRY");
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
    const findCheckRunByExternalId = vi.fn<GitHubChecksClient["findCheckRunByExternalId"]>(() =>
      Promise.resolve({ id: 88, externalId: "agentshield:scan:scan-1" }),
    );
    const createCheckRun = vi.fn<GitHubChecksClient["createCheckRun"]>();
    const updateCheckRun = vi.fn<GitHubChecksClient["updateCheckRun"]>(() =>
      Promise.resolve({ id: 88 }),
    );
    const checksClient: GitHubChecksClient = {
      findCheckRunByExternalId,
      createCheckRun,
      updateCheckRun,
    };
    const appClient: GitHubCheckAppClient = {
      createInstallationToken: vi.fn(() =>
        Promise.resolve({
          token: "t",
          expiresAt: new Date("2030-01-01T00:00:00Z"),
        }),
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
    const updateCall = updateCheckRun.mock.calls[0];
    expect(updateCall?.[0]).toBe("acme");
    expect(updateCall?.[1]).toBe("project");
    expect(updateCall?.[2]).toBe(88);
    expect(updateCall?.[3].externalId).toBe("agentshield:scan:scan-1");
    expect(updateCall?.[3].conclusion).toBe("failure");

    const finalPublicationUpdate = asRecord(database.publicationUpdates.at(-1));
    const finalPublicationData = asRecord(finalPublicationUpdate.data);
    expect(finalPublicationData.status).toBe("PUBLISHED");
    expect(finalPublicationData.checkRunId).toBe("88");
  });

  it("fails closed when a persisted receipt has an unknown gate result", async () => {
    const database = databaseForPublication();
    const clientRecord = database.client as unknown as {
      scan: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
    };
    clientRecord.scan.findUniqueOrThrow.mockResolvedValueOnce({
      id: "scan-1",
      status: ScanStatus.COMPLETED,
      organizationId: "org-1",
      commitSha: COMMIT_SHA,
      startedAt: new Date("2026-09-11T00:00:00Z"),
      completedAt: new Date("2026-09-11T00:01:00Z"),
      receipt: {
        findingCounts: {},
        gateResult: "UNKNOWN",
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
    });
    const appClient: GitHubCheckAppClient = {
      createInstallationToken: vi.fn(() =>
        Promise.resolve({ token: "t", expiresAt: new Date("2030-01-01T00:00:00Z") }),
      ),
      withInstallationToken: vi.fn(() => ({
        findCheckRunByExternalId: vi.fn(),
        createCheckRun: vi.fn(),
        updateCheckRun: vi.fn(),
      })),
    };

    await expect(
      processNextGitHubCheckPublication(database.client, appClient, "publisher-1"),
    ).resolves.toBe(true);

    const finalPublicationUpdate = asRecord(database.publicationUpdates.at(-1));
    const finalPublicationData = asRecord(finalPublicationUpdate.data);
    expect(finalPublicationData.status).toBe("FAILED");
    expect(finalPublicationData.failureMessage).toBe("GITHUB_CHECK_GATE_RESULT_INVALID");
  });
});
