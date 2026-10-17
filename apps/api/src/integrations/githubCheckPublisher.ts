import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { securityReceiptSchema } from "@agentshield/schemas";
import { canonicalJson, verifyReceiptHash } from "@agentshield/policy-engine";
import { type FetchGitHubAppClient, GitHubApiError } from "./githubApiClient.js";
import {
  buildGitHubCheckOutput,
  mapOutcomeToGitHubConclusion,
  type AgentShieldOutcome,
  type GitHubCheckRunRequest,
} from "./githubChecks.js";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 10;

// Claims/finalization are short database transactions; every HTTP request is outside.
export async function publishGitHubChecks(
  client: PrismaClient,
  github: FetchGitHubAppClient,
  scanId?: string,
  options: { signal?: AbortSignal; maxPublications?: number } = {},
): Promise<void> {
  if (options.signal?.aborted) return;
  const budget = Math.max(1, Math.min(20, Math.floor(options.maxPublications ?? 20)));

  // One due item per tenant before a tenant's next item. Not a production throughput claim.
  const pending = await client.$queryRaw<Array<{ scanId: string }>>`
    WITH due AS (
      SELECT p."scanId", p."nextAttemptAt",
        row_number() OVER (PARTITION BY s."organizationId" ORDER BY p."nextAttemptAt", p."scanId") AS lane
      FROM "GitHubCheckPublication" p JOIN "Scan" s ON s."id"=p."scanId"
      LEFT JOIN "ScanJob" j ON j."scanId"=s."id"
      WHERE p."status"='PENDING' AND (p."nextAttemptAt" <= clock_timestamp() OR
        (p."lastOutcome"='OBSERVED' AND p."publishedState" IS DISTINCT FROM
          CASE WHEN s."status" IN ('COMPLETED','CANCELLED') OR (s."status"='FAILED' AND j."deadLetteredAt" IS NOT NULL)
            THEN 'completed:' || s."status"::text WHEN s."status"='RUNNING' THEN 'in_progress' ELSE 'queued' END))
      AND (p."leaseExpiresAt" IS NULL OR p."leaseExpiresAt" <= clock_timestamp())
      AND (${scanId ?? null}::text IS NULL OR p."scanId"=${scanId ?? null})
    ) SELECT "scanId" FROM due ORDER BY lane, "nextAttemptAt", "scanId" LIMIT ${budget}`;
  for (const candidate of pending) {
    if (options.signal?.aborted) break;
    const claim = await client.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`github-check:${candidate.scanId}`}, 0)) AS locked`;
      if (!lock[0]?.locked) return null;
      const publication = await tx.gitHubCheckPublication.findUniqueOrThrow({
        where: { scanId: candidate.scanId },
      });
      const timestamp = (
        await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
      )[0]!.now;
      if (
        publication.status !== "PENDING" ||
        (publication.leaseExpiresAt != null && publication.leaseExpiresAt > timestamp)
      )
        return null;
      await tx.$queryRaw`SELECT "id" FROM "ScanJob" WHERE "scanId" = ${candidate.scanId} FOR SHARE`;
      let scan = await tx.scan.findUniqueOrThrow({
        where: { id: candidate.scanId },
        include: {
          job: true,
          receipt: true,
          repository: { include: { githubInstallation: true } },
          findings: { include: { policyDecision: true } },
        },
      });
      if (scan.repository?.githubInstallationId != null) {
        const selectedRepository = scan.repository;
        await tx.$queryRaw`SELECT "id" FROM "GitHubInstallation" WHERE "id"=${selectedRepository.githubInstallationId} AND "organizationId"=${scan.organizationId} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "Repository" WHERE "id"=${selectedRepository.id} AND "organizationId"=${scan.organizationId} FOR SHARE`;
        scan = await tx.scan.findUniqueOrThrow({
          where: { id: candidate.scanId },
          include: {
            job: true,
            receipt: true,
            repository: { include: { githubInstallation: true } },
            findings: { include: { policyDecision: true } },
          },
        });
        if (scan.repository?.githubInstallationId !== selectedRepository.githubInstallationId)
          throw new Error("GITHUB_INSTALLATION_MAPPING_CHANGED");
      }
      const terminal =
        scan.status === "COMPLETED" ||
        scan.status === "CANCELLED" ||
        (scan.status === "FAILED" && scan.job?.deadLetteredAt != null);
      const state = terminal
        ? `completed:${scan.status}`
        : scan.status === "RUNNING"
          ? "in_progress"
          : "queued";
      if (
        publication.nextAttemptAt > timestamp &&
        !(publication.lastOutcome === "OBSERVED" && publication.publishedState !== state)
      )
        return null;
      if (publication.publishedState === state && publication.lastOutcome === "OBSERVED") {
        await tx.gitHubCheckPublication.update({
          where: { scanId: scan.id },
          data: { nextAttemptAt: new Date(timestamp.getTime() + 5000) },
        });
        return null;
      }
      const organizationId = scan.organizationId;
      const repository = scan.repository,
        installation = repository?.githubInstallation;
      if (
        organizationId == null ||
        repository == null ||
        !repository.githubAccessible ||
        repository.organizationId !== organizationId ||
        installation == null ||
        installation.organizationId !== organizationId ||
        installation.status !== "ACTIVE" ||
        scan.commitSha == null ||
        !/^[a-f0-9]{40}$/i.test(scan.commitSha) ||
        /^0+$/.test(scan.commitSha) ||
        publication.attempts >= MAX_ATTEMPTS
      ) {
        await tx.gitHubCheckPublication.update({
          where: { scanId: scan.id },
          data: {
            status: "STOPPED",
            leaseOwner: null,
            leaseExpiresAt: null,
            failureCode:
              publication.attempts >= MAX_ATTEMPTS
                ? "GITHUB_RETRY_EXHAUSTED"
                : "GITHUB_AUTHORITY_UNAVAILABLE",
          },
        });
        if (organizationId != null)
          await audit(tx, organizationId, scan.id, "GITHUB_CHECK_FAILED", {
            failureCode: "GITHUB_PUBLICATION_STOPPED",
          });
        return null;
      }
      const parts = repository.fullName.split("/");
      if (
        parts.length !== 2 ||
        parts.some((part) => part === "." || part === ".." || !/^[A-Za-z0-9_.-]{1,100}$/.test(part))
      )
        throw new Error("GITHUB_REPOSITORY_IDENTITY_INVALID");
      const [owner, name] = parts as [string, string];
      const parsed = securityReceiptSchema.safeParse(scan.receipt?.signedPayload);
      const evidenceComplete =
        parsed.success &&
        scan.receipt != null &&
        verifyReceiptHash(parsed.data) &&
        parsed.data.receiptHash === scan.receipt.receiptHash &&
        parsed.data.scanId === scan.id &&
        parsed.data.commitSha === scan.commitSha &&
        parsed.data.coverage?.status === "COMPLETE";
      const counts: Record<string, number> = {};
      let outcome: AgentShieldOutcome = "ALLOW";
      const rank: Record<AgentShieldOutcome, number> = {
        ALLOW: 0,
        WARN: 1,
        REQUIRE_APPROVAL: 2,
        BLOCK: 3,
      };
      for (const finding of scan.findings) {
        counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
        const decision = finding.policyDecision?.decision ?? "ALLOW";
        if (rank[decision] > rank[outcome]) outcome = decision;
      }
      if (parsed.success && evidenceComplete && rank[parsed.data.gateResult] > rank[outcome]) {
        outcome = parsed.data.gateResult;
      }
      const request: GitHubCheckRunRequest = {
        owner,
        repository: name,
        name: "AgentShield Security",
        headSha: scan.commitSha,
        externalId: scan.id,
        status: terminal ? "completed" : scan.status === "RUNNING" ? "in_progress" : "queued",
        ...(terminal
          ? {
              conclusion:
                scan.status === "CANCELLED"
                  ? "cancelled"
                  : scan.status === "FAILED"
                    ? "failure"
                    : evidenceComplete
                      ? mapOutcomeToGitHubConclusion(outcome)
                      : "action_required",
              completedAt: scan.completedAt ?? new Date(),
            }
          : {}),
        ...(scan.status === "RUNNING" ? { startedAt: scan.startedAt } : {}),
        output: buildGitHubCheckOutput({
          outcome,
          findingCounts: counts,
          highestSeverity:
            ["CRITICAL", "HIGH", "MEDIUM", "LOW"].find((severity) => (counts[severity] ?? 0) > 0) ??
            "NONE",
          policyVersion: scan.job?.policyBundleVersion ?? "unknown",
        }),
      };
      request.output.summary += ` Scan ${scan.id}. ${Object.entries(counts)
        .map(([severity, count]) => `${severity}: ${count}`)
        .join("; ")}`;

      if (scan.status === "COMPLETED" && !evidenceComplete) {
        request.output.summary +=
          " Evidence is unavailable, invalid or incomplete; this Check cannot report success.";
      }
      const leaseOwner = randomUUID();
      const generation = publication.generation + 1;
      await tx.gitHubCheckPublication.update({
        where: { scanId: scan.id },
        data: {
          generation,
          leaseOwner,
          leaseExpiresAt: new Date(timestamp.getTime() + LEASE_MS),
          attempts: { increment: 1 },
          lastOutcome: "IN_FLIGHT",
          ...(publication.checkRunId == null ? { createMayHaveOccurred: true } : {}),
        },
      });
      await audit(tx, organizationId, scan.id, "GITHUB_CHECK_CLAIMED", {
        generation,
        attempt: publication.attempts + 1,
        state,
        commitSha: scan.commitSha,
        providerRepositoryId: repository.externalId,
        providerInstallationId: String(installation.installationId),
        requestDigest: createHash("sha256").update(canonicalJson(request)).digest("hex"),
        captureBoundary: "CLAIM_NOT_PROOF_OF_PROVIDER_RECEIPT",
      });
      return {
        scanId: scan.id,
        organizationId,
        installationId: installation.installationId,
        providerRepositoryId: repository.externalId,
        state,
        terminal,
        request,
        leaseOwner,
        generation,
        attempt: publication.attempts + 1,
        checkRunId: publication.checkRunId,
        allowCreate: !publication.createMayHaveOccurred,
      };
    });
    if (claim == null) continue;
    let createDispatched = false;
    let result: { id: number } | undefined;
    let failure: unknown;
    try {
      const deadline = AbortSignal.timeout(40_000);
      const provider = github.withSignal(
        options.signal == null ? deadline : AbortSignal.any([options.signal, deadline]),
      );
      const token = await provider.createInstallationToken(claim.installationId, {
        repositoryId: claim.providerRepositoryId,
        purpose: "CHECK_PUBLICATION",
      });
      const checks = provider.withInstallationToken(token.token);
      const existingId =
        claim.checkRunId == null
          ? await checks.findCheckRun(
              claim.request.owner,
              claim.request.repository,
              claim.request.headSha,
              claim.scanId,
            )
          : Number(claim.checkRunId);
      if (
        existingId != null &&
        (!Number.isSafeInteger(existingId) ||
          existingId <= 0 ||
          (claim.checkRunId != null && String(existingId) !== claim.checkRunId))
      )
        throw new GitHubApiError(0, false);
      if (existingId == null) {
        if (!claim.allowCreate) throw new Error("GITHUB_CREATE_OUTCOME_UNKNOWN");
        createDispatched = true;
        result = await checks.createCheckRun(claim.request);
      } else result = await checks.updateCheckRun(existingId, claim.request);
    } catch (error) {
      failure = error;
    }
    // Do not turn a database/audit failure after HTTP into a new provider request.
    // The durable dispatch marker and expired lease make the next claim reconcile.
    await client.$transaction(async (tx) => {
      const fenced = await tx.$executeRaw`UPDATE "GitHubCheckPublication"
        SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL
        WHERE "scanId" = ${claim.scanId} AND "status" = 'PENDING'
        AND "leaseOwner" = ${claim.leaseOwner} AND "generation" = ${claim.generation}
        AND "leaseExpiresAt" > clock_timestamp()`;
      if (fenced !== 1) return;
      const fence = {
        scanId: claim.scanId,
        status: "PENDING",
        generation: claim.generation,
        leaseOwner: null,
      };
      if (result != null) {
        const finalized = await tx.gitHubCheckPublication.updateMany({
          where: fence,
          data: {
            checkRunId: String(result.id),
            publishedState: claim.state,
            status: claim.terminal ? "COMPLETE" : "PENDING",
            attempts: 0,
            failureCode: null,
            nextAttemptAt: new Date(),
            lastOutcome: "OBSERVED",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        if (finalized.count !== 1) return;
        if (claim.terminal)
          await tx.gitHubWebhookDelivery.updateMany({
            where: { scanId: claim.scanId, organizationId: claim.organizationId },
            data: { status: "PROCESSED", processedAt: new Date() },
          });
        await audit(tx, claim.organizationId, claim.scanId, "GITHUB_CHECK_PUBLISHED", {
          checkRunId: String(result.id),
          state: claim.state,
          generation: claim.generation,
          attempt: claim.attempt,
          commitSha: claim.request.headSha,
        });
      } else {
        const unknown =
          createDispatched ||
          !claim.allowCreate ||
          (failure instanceof Error && failure.message === "GITHUB_CHECK_IDENTITY_AMBIGUOUS");
        const retryable = unknown || !(failure instanceof GitHubApiError) || failure.retryable;
        const failureCode = unknown
          ? "GITHUB_CREATE_OUTCOME_UNKNOWN"
          : failure instanceof GitHubApiError
            ? `GITHUB_HTTP_${failure.status}`
            : "GITHUB_PUBLICATION_UNAVAILABLE";
        const updated = await tx.gitHubCheckPublication.updateMany({
          where: fence,
          data: {
            status: !retryable || claim.attempt >= MAX_ATTEMPTS ? "STOPPED" : "PENDING",
            failureCode,
            lastOutcome: unknown || claim.checkRunId != null ? "UNKNOWN" : "NOT_DISPATCHED",
            nextAttemptAt: new Date(
              Date.now() +
                Math.max(
                  failure instanceof GitHubApiError ? (failure.retryAfterMs ?? 0) : 0,
                  Math.min(300_000, 1_000 * 2 ** claim.attempt) + Math.floor(Math.random() * 250),
                ),
            ),
            leaseOwner: null,
            leaseExpiresAt: null,
            ...(!unknown && claim.checkRunId == null ? { createMayHaveOccurred: false } : {}),
          },
        });
        if (updated.count !== 1) return;
        await audit(tx, claim.organizationId, claim.scanId, "GITHUB_CHECK_FAILED", {
          failureCode,
          attempt: claim.attempt,
          generation: claim.generation,
        });
      }
    });
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scanId: string,
  action: "GITHUB_CHECK_CLAIMED" | "GITHUB_CHECK_PUBLISHED" | "GITHUB_CHECK_FAILED",
  metadata: Prisma.InputJsonObject,
) {
  await tx.auditEvent.create({
    data: {
      organizationId,
      scanId,
      actor: "github:publisher",
      action,
      entityType: "GitHubCheckPublication",
      entityId: scanId,
      metadata,
    },
  });
}
