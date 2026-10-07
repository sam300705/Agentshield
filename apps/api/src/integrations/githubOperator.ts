import "../env.js";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { githubClientFromEnvironment } from "./githubRuntime.js";
import {
  registerGitHubInstallation,
  synchronizeGitHubRepositories,
} from "./githubInstallationService.js";

// Backend operator only. No user-facing endpoint accepts an installation-to-tenant override.
async function main() {
  const [command, organizationId, identifier] = process.argv.slice(2);
  const input = z
    .object({
      command: z.enum(["register", "retry-check", "verify-live"]),
      organizationId: z.string().min(1).max(128),
      identifier: z.string().min(1).max(128),
    })
    .parse({ command, organizationId, identifier });
  await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
  const github = githubClientFromEnvironment();
  if (input.command === "register") {
    const installationId = z.coerce
      .number()
      .int()
      .positive()
      .max(2147483647)
      .parse(input.identifier);
    const remote = await github.getInstallation(installationId);
    const registration = {
      organizationId: input.organizationId,
      installationId,
      accountLogin: remote.account.login,
      accountType: remote.account.type,
    };
    await registerGitHubInstallation(prisma, registration);
    const count = await synchronizeGitHubRepositories(prisma, github, registration);
    console.warn(
      `GitHub installation ${installationId} registered; ${count} repositories synchronized.`,
    );
  } else if (input.command === "retry-check") {
    await prisma.scan.findFirstOrThrow({
      where: { id: input.identifier, organizationId: input.organizationId },
    });
    await prisma.gitHubCheckPublication.update({
      where: { scanId: input.identifier },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date() },
    });
    console.warn("Check publication scheduled; scan evidence retained.");
  } else {
    const delivery = await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
      where: {
        organizationId_deliveryId: {
          organizationId: input.organizationId,
          deliveryId: input.identifier,
        },
      },
      include: {
        scan: {
          include: {
            job: true,
            githubCheck: true,
            repository: { include: { githubInstallation: true } },
          },
        },
      },
    });
    const scan = delivery.scan;
    if (
      delivery.status !== "PROCESSED" ||
      scan?.status !== "COMPLETED" ||
      scan.job?.status !== "COMPLETED" ||
      scan.commitSha == null ||
      scan.githubCheck?.status !== "COMPLETE" ||
      scan.githubCheck.checkRunId == null ||
      scan.repository?.githubInstallation == null
    )
      throw new Error("LIVE_LIFECYCLE_INCOMPLETE");
    const installation = scan.repository.githubInstallation;
    const token = await github.createInstallationToken(installation.installationId);
    const [owner, repository] = scan.repository.fullName.split("/");
    if (owner == null || repository == null) throw new Error("LIVE_REPOSITORY_INVALID");
    const check = await github
      .withInstallationToken(token.token)
      .getCheckRun(owner, repository, scan.githubCheck.checkRunId);
    if (
      check.head_sha !== scan.commitSha ||
      check.external_id !== scan.id ||
      check.status !== "completed"
    )
      throw new Error("LIVE_CHECK_MISMATCH");
    console.warn(
      JSON.stringify({
        result: "PASS",
        repository: scan.repository.fullName,
        repositoryId: scan.repository.externalId,
        installationId: installation.installationId,
        deliveryId: delivery.deliveryId,
        scanId: scan.id,
        commitSha: scan.commitSha,
        checkRunId: check.id,
        conclusion: check.conclusion,
      }),
    );
  }
}
main()
  .catch(() => {
    console.error("GitHub operator action failed; verify configuration and scoped identifiers.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
