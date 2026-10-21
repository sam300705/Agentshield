import type { PrismaClient } from "@prisma/client";
import { securityReceiptSchema } from "@agentshield/schemas";
import { canonicalJson, verifyReceiptHash } from "@agentshield/policy-engine";
import type { FetchGitHubAppClient } from "./githubApiClient.js";
import { mapOutcomeToGitHubConclusion } from "./githubChecks.js";

// Read-only backend operator diagnostic. PASS is a bounded observation, not a
// signature/safety judgment or a claim that provider/local state cannot change later.
export async function verifyGitHubDelivery(
  client: PrismaClient,
  github: FetchGitHubAppClient,
  organizationId: string,
  deliveryId: string,
) {
  const read = () =>
    client.$transaction(
      (tx) =>
        tx.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { organizationId_deliveryId: { organizationId, deliveryId } },
          include: {
            scan: {
              include: {
                job: true,
                githubCheck: true,
                receipt: true,
                repository: { include: { githubInstallation: true } },
                findings: { include: { policyDecision: true }, orderBy: { id: "asc" } },
              },
            },
          },
        }),
      { isolationLevel: "RepeatableRead" },
    );
  const delivery = await read();
  const scan = delivery.scan;
  const repository = scan?.repository;
  const installation = repository?.githubInstallation;
  const publication = scan?.githubCheck;
  if (
    delivery.status !== "PROCESSED" ||
    scan == null ||
    scan.organizationId !== organizationId ||
    scan.status !== "COMPLETED" ||
    scan.job?.status !== "COMPLETED" ||
    repository == null ||
    repository.organizationId !== organizationId ||
    repository.provider !== "GITHUB" ||
    !repository.githubAccessible ||
    installation == null ||
    installation.organizationId !== organizationId ||
    installation.status !== "ACTIVE" ||
    installation.installationId !== delivery.installationId ||
    repository.externalId !== delivery.repositoryExternalId ||
    !Number.isSafeInteger(installation.installationId) ||
    installation.installationId <= 0 ||
    scan.commitSha == null ||
    !/^[a-f0-9]{40}$/i.test(scan.commitSha) ||
    /^0+$/.test(scan.commitSha) ||
    delivery.commitSha !== scan.commitSha ||
    publication?.status !== "COMPLETE" ||
    publication.lastOutcome !== "OBSERVED" ||
    publication.publishedState !== "completed:COMPLETED" ||
    publication.leaseOwner != null ||
    publication.leaseExpiresAt != null ||
    publication.failureCode != null
  )
    throw new Error("LIVE_LIFECYCLE_INCOMPLETE");
  const safeId = (value: string | null): number => {
    const number = Number(value);
    if (
      value == null ||
      !/^[1-9][0-9]*$/.test(value) ||
      !Number.isSafeInteger(number) ||
      String(number) !== value
    )
      throw new Error("LIVE_PROVIDER_ID_INVALID");
    return number;
  };
  safeId(repository.externalId);
  const checkRunId = safeId(publication.checkRunId);
  const parts = repository.fullName.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z0-9_.-]{1,100}$/.test(part) || part === "." || part === "..")
  )
    throw new Error("LIVE_REPOSITORY_INVALID");
  const parsed = securityReceiptSchema.safeParse(scan.receipt?.signedPayload);
  if (
    !parsed.success ||
    scan.receipt == null ||
    !verifyReceiptHash(parsed.data) ||
    parsed.data.receiptHash !== scan.receipt.receiptHash ||
    parsed.data.scanId !== scan.id ||
    parsed.data.commitSha !== scan.commitSha ||
    parsed.data.coverage?.status !== "COMPLETE"
  )
    throw new Error("LIVE_RECEIPT_INCOMPLETE");
  const rank = { ALLOW: 0, WARN: 1, REQUIRE_APPROVAL: 2, BLOCK: 3 } as const;
  let outcome = parsed.data.gateResult;
  for (const finding of scan.findings) {
    const decision = finding.policyDecision?.decision ?? "ALLOW";
    if (rank[decision] > rank[outcome]) outcome = decision;
  }
  const expectedConclusion = mapOutcomeToGitHubConclusion(outcome);
  const provider = github.withSignal(AbortSignal.timeout(20_000));
  const token = await provider.createInstallationToken(installation.installationId, {
    repositoryId: repository.externalId,
    purpose: "VERIFY_CHECK",
  });
  const check = await provider
    .withInstallationToken(token.token)
    .getCheckRun(parts[0]!, parts[1]!, checkRunId);
  if (
    check.id !== checkRunId ||
    check.head_sha !== scan.commitSha ||
    check.external_id !== scan.id ||
    check.status !== "completed" ||
    check.conclusion !== expectedConclusion
  )
    throw new Error("LIVE_CHECK_MISMATCH");
  // Re-read after HTTP; no transaction is held open across the provider request.
  // Compare in memory only: this is neither a persisted context digest nor anonymization.
  if (canonicalJson(await read()) !== canonicalJson(delivery))
    throw new Error("LIVE_CONTEXT_CHANGED");
  const signatureFields = [
    scan.receipt.signature,
    scan.receipt.keyId,
    scan.receipt.signingAlgorithm,
  ];
  return {
    result: "PASS" as const,
    scope: "GITHUB_CHECK_OBSERVATION" as const,
    repository: repository.fullName,
    repositoryId: repository.externalId,
    installationId: installation.installationId,
    deliveryId,
    scanId: scan.id,
    commitSha: scan.commitSha,
    checkRunId: check.id,
    conclusion: check.conclusion,
    receiptHash: parsed.data.receiptHash,
    coverage: parsed.data.coverage.status,
    hashVerification: "VERIFIED" as const,
    signatureVerification: signatureFields.every((value) => value == null)
      ? ("UNSIGNED" as const)
      : ("NOT_VERIFIED" as const),
    captureBoundary: "SUPPORTED_GITHUB_DELIVERY_AND_OBSERVED_CHECK" as const,
  };
}
