import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authorityRevokeSchema } from "@agentshield/schemas";
import { getActor, getCorrelationId } from "../security/auth.js";
import * as authority from "../services/actionAuthorityService.js";
const authorizationParams = z
  .object({ authorizationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })
  .strict();
const operationParams = z
  .object({ operationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })
  .strict();
export async function getPolicy(_request: Request, response: Response) {
  response.json({ data: await authority.getAuthorityPolicy(getActor(response)) });
}
export async function updatePolicy(request: Request, response: Response) {
  response.json({
    data: await authority.updateAuthorityPolicy(
      getActor(response),
      request.body,
      getCorrelationId(response),
    ),
  });
}
export async function submitIntent(request: Request, response: Response) {
  const data = await authority.submitActionIntent(
    getActor(response),
    request.body,
    getCorrelationId(response),
  );
  response.status(data.created ? 201 : 200).json({ data });
}
export async function getIntent(request: Request, response: Response) {
  const { authorizationId } = authorizationParams.parse(request.params);
  response.json({
    data: await authority.getActionAuthorization(getActor(response), authorizationId),
  });
}
export async function reviewIntent(request: Request, response: Response) {
  const { authorizationId } = authorizationParams.parse(request.params);
  response.json({
    data: await authority.reviewActionAuthorization(
      getActor(response),
      authorizationId,
      request.body,
      getCorrelationId(response),
    ),
  });
}
export async function revokeIntent(request: Request, response: Response) {
  const { authorizationId } = authorizationParams.parse(request.params);
  const { contextDigest } = authorityRevokeSchema.parse(request.body);
  response.json({
    data: await authority.revokeActionAuthorization(
      getActor(response),
      authorizationId,
      contextDigest,
      getCorrelationId(response),
    ),
  });
}
export async function admitOperation(request: Request, response: Response) {
  response.json({
    data: await authority.admitActionOperation(
      getActor(response),
      request.body,
      getCorrelationId(response),
    ),
  });
}
export async function getOperation(request: Request, response: Response) {
  const { operationId } = operationParams.parse(request.params);
  response.json({ data: await authority.getActionOperation(getActor(response), operationId) });
}
export async function cancelOperation(request: Request, response: Response) {
  const { operationId } = operationParams.parse(request.params);
  z.object({})
    .strict()
    .parse(request.body ?? {});
  response.json({
    data: await authority.cancelActionOperation(
      getActor(response),
      operationId,
      getCorrelationId(response),
    ),
  });
}

export function validateQuery(request: Request, _response: Response, next: NextFunction) {
  z.object({}).strict().parse(request.query);
  next();
}
