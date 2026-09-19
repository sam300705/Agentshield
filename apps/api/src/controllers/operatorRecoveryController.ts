import { type Request, type Response } from "express";
import { z } from "zod";

import { getActor, getCorrelationId } from "../security/auth.js";
import {
  RecoveryStateConflictError,
  retryDeadLetteredGitHubCheckPublication,
  retryDeadLetteredScan,
} from "../services/operatorRecovery.js";

const paramsSchema = z.object({ scanId: z.string().min(1).max(128) });

function conflictResponse(response: Response, code: string): void {
  response.status(409).json({
    error: {
      code,
      message: "The operation is not currently eligible for an operator retry.",
      correlationId: getCorrelationId(response),
    },
  });
}

export async function retryDeadLetteredScanController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { scanId } = paramsSchema.parse(request.params);
  try {
    const result = await retryDeadLetteredScan(
      scanId,
      actor.organizationId,
      actor.id,
      getCorrelationId(response),
    );
    if (result == null) {
      conflictResponse(response, "SCAN_RETRY_NOT_AVAILABLE");
      return;
    }
    response.status(202).json({ data: result, correlationId: getCorrelationId(response) });
  } catch (error) {
    if (error instanceof RecoveryStateConflictError) {
      conflictResponse(response, error.message);
      return;
    }
    throw error;
  }
}

export async function retryDeadLetteredGitHubCheckController(
  request: Request,
  response: Response,
): Promise<void> {
  const actor = getActor(response);
  const { scanId } = paramsSchema.parse(request.params);
  try {
    const result = await retryDeadLetteredGitHubCheckPublication(
      scanId,
      actor.organizationId,
      actor.id,
      getCorrelationId(response),
    );
    if (result == null) {
      conflictResponse(response, "GITHUB_CHECK_RETRY_NOT_AVAILABLE");
      return;
    }
    response.status(202).json({ data: result, correlationId: getCorrelationId(response) });
  } catch (error) {
    if (error instanceof RecoveryStateConflictError) {
      conflictResponse(response, error.message);
      return;
    }
    throw error;
  }
}
