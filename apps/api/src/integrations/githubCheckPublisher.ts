import type { Prisma, PrismaClient } from "@prisma/client";
import { type FetchGitHubAppClient, GitHubApiError } from "./githubApiClient.js";
import {
  buildGitHubCheckOutput,
  mapOutcomeToGitHubConclusion,
  type AgentShieldOutcome,
  type GitHubCheckRunRequest,
} from "./githubChecks.js";

// Serialized per scan, independent of scan leases. No stale executor receives a Checks client.
export async function publishGitHubChecks(
  client: PrismaClient,
  github: FetchGitHubAppClient,
  scanId?: string,
): Promise<void> {
  const pending = await client.gitHubCheckPublication.findMany({
    where: {
      ...(scanId == null ? {} : { scanId }),
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
    },
    take: 20,
    orderBy: { nextAttemptAt: "asc" },
  });
  for (const candidate of pending) {
    await client.$transaction(
      async (tx) => {
        const provider = github.withSignal(AbortSignal.timeout(40_000));
        const lock = await tx.$queryRaw<
          Array<{ locked: boolean }>
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`github-check:${candidate.scanId}`}, 0)) AS locked`;
        if (!lock[0]?.locked) return;
        const publication = await tx.gitHubCheckPublication.findUniqueOrThrow({
          where: { scanId: candidate.scanId },
        });
        if (publication.status === "STOPPED" || publication.nextAttemptAt > new Date()) return;
        // Keep job state stable while publishing. Queue/result writers lock job before scan.
        await tx.$queryRaw`SELECT "id" FROM "ScanJob" WHERE "scanId" = ${candidate.scanId} FOR SHARE`;
        const scan = await tx.scan.findUniqueOrThrow({
          where: { id: candidate.scanId },
          include: {
            job: true,
            repository: { include: { githubInstallation: true } },
            findings: { include: { policyDecision: true } },
          },
        });
        const terminal =
          scan.status === "COMPLETED" ||
          scan.status === "CANCELLED" ||
          (scan.status === "FAILED" && scan.job?.deadLetteredAt != null);
        const state = terminal
          ? `completed:${scan.status}`
          : scan.status === "RUNNING"
            ? "in_progress"
            : "queued";
        if (publication.publishedState === state) return;
        const organizationId = scan.organizationId;
        if (organizationId == null) throw new Error("GITHUB_SCAN_TENANT_REQUIRED");
        const repository = scan.repository;
        const installation = repository?.githubInstallation;
        try {
          if (
            repository == null ||
            !repository.githubAccessible ||
            repository.organizationId !== organizationId ||
            installation == null ||
            installation.organizationId !== organizationId ||
            installation.status !== "ACTIVE" ||
            scan.commitSha == null
          )
            throw new GitHubApiError(403, false);
          const [owner, name] = repository.fullName.split("/");
          if (owner == null || name == null) throw new GitHubApiError(0, false);
          const token = await provider.createInstallationToken(installation.installationId);
          const checks = provider.withInstallationToken(token.token);
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
                        : mapOutcomeToGitHubConclusion(outcome),
                  completedAt: scan.completedAt ?? new Date(),
                }
              : {}),
            ...(scan.status === "RUNNING" ? { startedAt: scan.startedAt } : {}),
            output: buildGitHubCheckOutput({
              outcome,
              findingCounts: counts,
              highestSeverity:
                ["CRITICAL", "HIGH", "MEDIUM", "LOW"].find(
                  (severity) => (counts[severity] ?? 0) > 0,
                ) ?? "NONE",
              policyVersion: scan.job?.policyBundleVersion ?? "unknown",
            }),
          };
          request.output.summary += ` Scan ${scan.id}. ${Object.entries(counts)
            .map(([severity, count]) => `${severity}: ${count}`)
            .join("; ")}`;
          // Reconcile a provider create that succeeded before our database commit/crash.
          const existingId =
            publication.checkRunId ??
            (await checks.findCheckRun(owner, name, scan.commitSha, scan.id));
          const result =
            existingId == null
              ? await checks.createCheckRun(request)
              : await checks.updateCheckRun(existingId, request);
          await tx.gitHubCheckPublication.update({
            where: { scanId: scan.id },
            data: {
              checkRunId: result.id,
              publishedState: state,
              status: terminal ? "COMPLETE" : "PENDING",
              attempts: 0,
              failureCode: null,
              nextAttemptAt: new Date(),
            },
          });
          if (terminal)
            await tx.gitHubWebhookDelivery.updateMany({
              where: { scanId: scan.id, organizationId },
              data: { status: "PROCESSED", processedAt: new Date() },
            });
          await audit(tx, organizationId, scan.id, "GITHUB_CHECK_PUBLISHED", {
            checkRunId: result.id,
            state,
            attempt: scan.job?.attempts ?? 0,
            commitSha: scan.commitSha,
            installationId: installation.installationId,
          });
        } catch (error) {
          const attempt = publication.attempts + 1;
          const retryable = error instanceof GitHubApiError ? error.retryable : true;
          const failureCode =
            error instanceof GitHubApiError
              ? `GITHUB_HTTP_${error.status}`
              : "GITHUB_PUBLICATION_UNAVAILABLE";
          await tx.gitHubCheckPublication.update({
            where: { scanId: scan.id },
            data: {
              status: !retryable || attempt >= 10 ? "STOPPED" : "PENDING",
              attempts: attempt,
              failureCode,
              nextAttemptAt: new Date(
                Date.now() +
                  Math.max(
                    error instanceof GitHubApiError ? (error.retryAfterMs ?? 0) : 0,
                    Math.min(300_000, 1_000 * 2 ** attempt),
                  ),
              ),
            },
          });
          await audit(tx, organizationId, scan.id, "GITHUB_CHECK_FAILED", { failureCode, attempt });
        }
      },
      { timeout: 60_000 },
    );
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scanId: string,
  action: "GITHUB_CHECK_PUBLISHED" | "GITHUB_CHECK_FAILED",
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
