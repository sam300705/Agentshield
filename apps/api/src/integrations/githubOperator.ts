import "../env.js";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { githubClientFromEnvironment } from "./githubRuntime.js";
import { verifyGitHubDelivery } from "./githubDeliveryVerifier.js";
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
    console.warn(
      JSON.stringify(
        await verifyGitHubDelivery(prisma, github, input.organizationId, input.identifier),
      ),
    );
  }
}
main()
  .catch(() => {
    console.error("GitHub operator action failed; verify configuration and scoped identifiers.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
