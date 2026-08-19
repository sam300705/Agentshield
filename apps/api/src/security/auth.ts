import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";

export const roles = [
  "VIEWER",
  "DEVELOPER",
  "SECURITY_REVIEWER",
  "POLICY_ADMINISTRATOR",
  "ORGANIZATION_ADMINISTRATOR",
] as const;
export type Role = (typeof roles)[number];
export type Permission =
  | "scan:read"
  | "scan:run"
  | "approval:review"
  | "policy:simulate"
  | "policy:manage"
  | "organization:manage";

const permissions: Record<Role, ReadonlySet<Permission>> = {
  VIEWER: new Set(["scan:read"]),
  DEVELOPER: new Set(["scan:read", "scan:run", "policy:simulate"]),
  SECURITY_REVIEWER: new Set(["scan:read", "approval:review", "policy:simulate"]),
  POLICY_ADMINISTRATOR: new Set(["scan:read", "policy:simulate", "policy:manage"]),
  ORGANIZATION_ADMINISTRATOR: new Set([
    "scan:read",
    "scan:run",
    "approval:review",
    "policy:simulate",
    "policy:manage",
    "organization:manage",
  ]),
};

const demoUsers = {
  viewer: { id: "demo-viewer", role: "VIEWER" as Role },
  sambhav: { id: "demo-developer-sambhav", role: "DEVELOPER" as Role },
  maya: { id: "demo-reviewer-maya", role: "SECURITY_REVIEWER" as Role },
  priya: { id: "demo-policy-admin-priya", role: "POLICY_ADMINISTRATOR" as Role },
  admin: { id: "demo-org-admin", role: "ORGANIZATION_ADMINISTRATOR" as Role },
};

export interface RequestActor {
  id: string;
  role: Role;
  organizationId: string;
  demo: boolean;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissions[role].has(permission);
}

export function canIndependentlyApprove(actor: RequestActor, requestedBy: string): boolean {
  return hasPermission(actor.role, "approval:review") && actor.id !== requestedBy;
}

export function getActor(response: Response): RequestActor {
  return response.locals.actor as RequestActor;
}

export function getCorrelationId(response: Response): string {
  const value = response.getHeader("x-correlation-id");
  return typeof value === "string" ? value : "unknown";
}

export const requestContext: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const requestedDemoUser = request.header("x-agentshield-demo-user") ?? "viewer";
  const demoUser = demoUsers[requestedDemoUser as keyof typeof demoUsers] ?? demoUsers.viewer;
  const suppliedCorrelation = request.header("x-correlation-id");
  const correlationId =
    suppliedCorrelation != null && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedCorrelation)
      ? suppliedCorrelation
      : randomUUID();
  response.locals.actor = {
    ...demoUser,
    organizationId: "demo-organization",
    demo: true,
  } satisfies RequestActor;
  response.locals.correlationId = correlationId;
  response.setHeader("x-correlation-id", correlationId);
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (_request, response, next) => {
    const actor = getActor(response);
    if (!hasPermission(actor.role, permission)) {
      response.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: `Role ${actor.role} cannot perform ${permission}.`,
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }
    next();
  };
}
