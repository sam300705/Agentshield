import { ScanStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { sanitizeText } from "@agentshield/schemas";

import type { RuntimeConfig } from "../config.js";
import { FetchGitHubAppClient } from "../integrations/githubApiClient.js";
import {
  buildGitHubCheckOutput,
  mapOutcomeToGitHubConclusion,
  type AgentShieldOutcome,
  type GitHubChecksClient,
} from "../integrations/githubChecks.js";

const PUBLICATION_LEASE_MS = 2 * 60_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;
const FAILURE_MESSAGE_MAX = 500;
const DISCOVERY_BATCH_SIZE = 50;
const CLAIM_BATCH_SIZE = 20;
const CHECK_NAME = "AgentShield";

export interface GitHubCheckAppClient {
  createInstallationToken(installationId: number): Promise<{ token: string; expiresAt: Date }>;
  withInstallationToken(token: string): GitHubChecksClient;
}

export function calculateGitHubCheckRetryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(attempt) - 1));
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
  const jitter = Math.floor(random() * Math.min(2_000, Math.max(1, Math.floor(base / 4))));
  return Math.min(RETRY_MAX_MS, base + jitter);
}

export function createGitHubCheckAppClient(config: RuntimeConfig): GitHubCheckAppClient | null {
  if (!config.githubChecksEnabled) return null;
  if (
    config.GITHUB_APP_ID == null ||
    config.GITHUB_PRIVATE_KEY == null ||
    config.GITHUB_WEBHOOK_SECRET == null
  ) {
    throw new Error("GITHUB_CHECKS_CONFIGURATION_INVALID");
  }
  return new FetchGitHubAppClient({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
    webhookSecret: config.GITHUB_WEBHOOK_SECRET,
    ...(config.GITHUB_CLIENT_ID == null ? {} : { clientId: config.GITHUB_CLIENT_ID }),
  });
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value : {};
}

function findingCounts(value: Prisma.JsonValue): Record<string, number> {
  return Object.fromEntries(
    Object.entries(jsonRecord(value)).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
    ),
  );
}

function parseAgentShieldOutcome(value: string): AgentShieldOutcome {
  switch (value) {
    case "ALLOW":
    case "WARN":
    case "REQUIRE_APPROVAL":
    case "BLOCK":
      return value;
    default:
      throw new Error("GITHUB_CHECK_GATE_RESULT_INVALID");
  }
}

function highestSeverity(counts: Record<string, number>): string | undefined {
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW"].find((severity) => (counts[severity] ?? 0) > 0);
}

function splitRepository(fullName: string): { owner: string; repository: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part))) {
    throw new Error("GITHUB_CHECK_REPOSITORY_IDENTITY_INVALID");
  }
  return { owner: parts[0]!, repository: parts[1]! };
}

function detailsUrl(baseUrl: string | undefined, scanId: string): string | undefined {
  if (baseUrl == null) return undefined;
  const url = new URL(baseUrl);
  url.pathname = `/scans/${encodeURIComponent(scanId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function discoverGitHubCheckPublications(client: PrismaClient): Promise<number> {
  const scans = await client.scan.findMany({
    where: {
      status: ScanStatus.COMPLETED,
      organizationId: { not: null },
      commitSha: { not: null },
      receipt: { isNot: null },
      githubCheckPublication: { is: null },
      repository: {
        is: {
          provider: "GITHUB",
          githubInstallation: { is: { status: "ACTIVE" } },
        },
      },
    },
    orderBy: { completedAt: "asc" },
    take: DISCOVERY_BATCH_SIZE,
    select: { id: true, organizationId: true },
  });
  const data = scans.flatMap((scan) =>
    scan.organizationId == null ? [] : [{ scanId: scan.id, organizationId: scan.organizationId }],
  );
  if (data.length === 0) return 0;
  const result = await client.gitHubCheckPublication.createMany({
    data,
    skipDuplicates: true,
  });
  return result.count;
}

export async function recoverAbandonedGitHubCheckPublications(
  client: PrismaClient,
  now = new Date(),
): Promise<number> {
  const result = await client.gitHubCheckPublication.updateMany({
    where: {
      status: "RUNNING",
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: "FAILED",
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      failureMessage: "GitHub Check publisher lease expired; publication is eligible for retry.",
      nextAttemptAt: now,
    },
  });
  return result.count;
}

async function claimPublication(client: PrismaClient, workerId: string, now: Date) {
  const candidates = await client.gitHubCheckPublication.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      deadLetteredAt: null,
      lockedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: CLAIM_BATCH_SIZE,
  });
  const candidate = candidates.find((item) => item.attempts < item.maxAttempts);
  if (candidate == null) return null;

  const claimed = await client.gitHubCheckPublication.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      attempts: candidate.attempts,
      lockedAt: null,
    },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      lockedAt: now,
      lockedBy: workerId,
      leaseExpiresAt: new Date(now.getTime() + PUBLICATION_LEASE_MS),
      failureMessage: null,
    },
  });
  if (claimed.count !== 1) return null;
  return client.gitHubCheckPublication.findUniqueOrThrow({ where: { id: candidate.id } });
}

export async function processNextGitHubCheckPublication(
  client: PrismaClient,
  appClient: GitHubCheckAppClient | null,
  workerId: string,
  dashboardPublicUrl?: string,
): Promise<boolean> {
  if (appClient == null) return false;
  await recoverAbandonedGitHubCheckPublications(client);
  await discoverGitHubCheckPublications(client);
  const publication = await claimPublication(client, workerId, new Date());
  if (publication == null) return false;

  try {
    const scan = await client.scan.findUniqueOrThrow({
      where: { id: publication.scanId },
      select: {
        id: true,
        status: true,
        organizationId: true,
        commitSha: true,
        startedAt: true,
        completedAt: true,
        receipt: {
          select: {
            findingCounts: true,
            gateResult: true,
            policyBundleVersion: true,
          },
        },
        repository: {
          select: {
            organizationId: true,
            provider: true,
            fullName: true,
            githubInstallation: {
              select: {
                installationId: true,
                status: true,
                permissions: true,
              },
            },
          },
        },
      },
    });
    if (
      scan.status !== ScanStatus.COMPLETED ||
      scan.organizationId == null ||
      scan.organizationId !== publication.organizationId ||
      scan.repository == null ||
      scan.repository.organizationId !== publication.organizationId ||
      scan.repository.provider !== "GITHUB" ||
      scan.repository.githubInstallation == null ||
      scan.repository.githubInstallation.status !== "ACTIVE" ||
      scan.receipt == null ||
      scan.commitSha == null ||
      !/^[a-f0-9]{40}$/i.test(scan.commitSha)
    ) {
      throw new Error("GITHUB_CHECK_PUBLICATION_TARGET_INVALID");
    }
    const permissions = jsonRecord(scan.repository.githubInstallation.permissions);
    if (permissions.checks !== "write") {
      throw new Error("GITHUB_CHECKS_WRITE_PERMISSION_REQUIRED");
    }

    const { owner, repository } = splitRepository(scan.repository.fullName);
    const token = await appClient.createInstallationToken(
      scan.repository.githubInstallation.installationId,
    );
    if (token.token.length === 0 || token.expiresAt.getTime() <= Date.now()) {
      throw new Error("GITHUB_CHECK_INSTALLATION_TOKEN_INVALID");
    }
    const checksClient = appClient.withInstallationToken(token.token);
    const externalId = `agentshield:scan:${scan.id}`;
    const counts = findingCounts(scan.receipt.findingCounts);
    const outcome = parseAgentShieldOutcome(scan.receipt.gateResult);
    const scanDetailsUrl = detailsUrl(dashboardPublicUrl, scan.id);
    const request = {
      owner,
      repository,
      name: CHECK_NAME,
      headSha: scan.commitSha,
      externalId,
      status: "completed" as const,
      conclusion: mapOutcomeToGitHubConclusion(outcome),
      detailsUrl: scanDetailsUrl,
      output: buildGitHubCheckOutput({
        outcome,
        findingCounts: counts,
        highestSeverity: highestSeverity(counts),
        policyVersion: scan.receipt.policyBundleVersion,
        scanUrl: scanDetailsUrl,
      }),
      startedAt: scan.startedAt,
      completedAt: scan.completedAt ?? new Date(),
    };

    let checkRunId: number | null = null;
    if (publication.checkRunId != null) {
      const parsed = Number(publication.checkRunId);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error("PERSISTED_GITHUB_CHECK_RUN_ID_INVALID");
      }
      checkRunId = parsed;
    } else {
      const reconciled = await checksClient.findCheckRunByExternalId(
        owner,
        repository,
        scan.commitSha,
        externalId,
      );
      checkRunId = reconciled?.id ?? null;
    }

    const result =
      checkRunId == null
        ? await checksClient.createCheckRun(request)
        : await checksClient.updateCheckRun(owner, repository, checkRunId, request);

    const transitioned = await client.gitHubCheckPublication.updateMany({
      where: { id: publication.id, status: "RUNNING", lockedBy: workerId },
      data: {
        status: "PUBLISHED",
        checkRunId: String(result.id),
        publishedAt: new Date(),
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        failureMessage: null,
      },
    });
    if (transitioned.count !== 1) throw new Error("GITHUB_CHECK_PUBLICATION_LEASE_LOST");
  } catch (error) {
    const exhausted = publication.attempts >= publication.maxAttempts;
    const message = sanitizeText(
      error instanceof Error ? error.message : "Unknown GitHub Check publication failure",
    ).slice(0, FAILURE_MESSAGE_MAX);
    const transitioned = await client.gitHubCheckPublication.updateMany({
      where: { id: publication.id, status: "RUNNING", lockedBy: workerId },
      data: {
        status: exhausted ? "DEAD_LETTER" : "FAILED",
        failureMessage: message,
        deadLetteredAt: exhausted ? new Date() : null,
        nextAttemptAt: exhausted
          ? null
          : new Date(Date.now() + calculateGitHubCheckRetryDelayMs(publication.attempts)),
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
      },
    });
    if (transitioned.count !== 1) throw new Error("GITHUB_CHECK_PUBLICATION_LEASE_LOST");
  }
  return true;
}
