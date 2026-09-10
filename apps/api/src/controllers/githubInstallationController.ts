import type { Request, Response } from "express";
import { z } from "zod";

import { getRuntimeConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { FetchGitHubAppClient } from "../integrations/githubApiClient.js";
import { bindAndSynchronizeGitHubInstallation } from "../integrations/githubInstallationBindingService.js";
import { getActor, getCorrelationId } from "../security/auth.js";

const installationParamsSchema = z.object({
  installationId: z.coerce.number().int().positive(),
});

export async function synchronizeGitHubInstallationController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { installationId } = installationParamsSchema.parse(request.params);
  const config = getRuntimeConfig();

  if (!config.githubScanLifecycleEnabled) {
    response.status(409).json({
      error: {
        code: "GITHUB_LIFECYCLE_DISABLED",
        message: "GitHub scan lifecycle is not enabled for this deployment.",
        correlationId: getCorrelationId(response),
      },
    });
    return;
  }
  if (
    config.GITHUB_APP_ID == null ||
    config.GITHUB_PRIVATE_KEY == null ||
    config.GITHUB_WEBHOOK_SECRET == null
  ) {
    throw new Error("GitHub App lifecycle configuration is incomplete.");
  }

  const githubClient = new FetchGitHubAppClient({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
    webhookSecret: config.GITHUB_WEBHOOK_SECRET,
    ...(config.GITHUB_CLIENT_ID == null ? {} : { clientId: config.GITHUB_CLIENT_ID }),
  });

  try {
    const result = await bindAndSynchronizeGitHubInstallation(prisma, githubClient, {
      organizationId: actor.organizationId,
      installationId,
    });
    response.status(200).json({
      data: result,
      correlationId: getCorrelationId(response),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "GITHUB_INSTALLATION_SUSPENDED") {
      response.status(409).json({
        error: {
          code: "GITHUB_INSTALLATION_SUSPENDED",
          message: "The GitHub App installation is suspended and cannot be synchronized.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    if (message === "GITHUB_INSTALLATION_IDENTITY_MISMATCH") {
      response.status(502).json({
        error: {
          code: "GITHUB_INSTALLATION_VERIFICATION_FAILED",
          message: "GitHub returned inconsistent installation identity metadata.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    if (message.includes("already owned by another organization")) {
      response.status(409).json({
        error: {
          code: "GITHUB_INSTALLATION_ALREADY_BOUND",
          message: "This GitHub installation is already bound to another organization.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    throw error;
  }
}
