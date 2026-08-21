import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

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

const recognizedRoleClaims = new Set<string>(roles);
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface RequestActor {
  id: string;
  role: Role;
  organizationId: string;
  demo: boolean;
}

type AuthClaims = JWTPayload & {
  role?: unknown;
  roles?: unknown;
  organization_id?: unknown;
  [claim: string]: unknown;
  organizationId?: unknown;
  org_id?: unknown;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isDemoAuthEnabled(): boolean {
  return !isProduction() && process.env.DEMO_AUTH_ENABLED === "true";
}

function getBearerToken(request: Request): string | null {
  const header = request.header("authorization");
  if (header == null) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function toClaimValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function mapRole(claims: AuthClaims): Role | null {
  const configuredClaim = process.env.OIDC_ROLE_CLAIM?.trim();
  const configuredValue = configuredClaim == null ? undefined : claims[configuredClaim];
  const values = [configuredValue, claims.role, claims.roles].flatMap(toClaimValues);
  const role = values.find(
    (value): value is string => typeof value === "string" && recognizedRoleClaims.has(value),
  );
  return role != null && recognizedRoleClaims.has(role) ? (role as Role) : null;
}

function mapOrganizationId(claims: AuthClaims): string | null {
  const candidates = [claims.organization_id, claims.organizationId, claims.org_id];
  const organizationId = candidates.find(
    (value): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value),
  );
  return organizationId ?? null;
}

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(url);
  if (cached != null) return cached;
  const remote = createRemoteJWKSet(new URL(url));
  jwksCache.set(url, remote);
  return remote;
}

async function verifyOidcToken(token: string): Promise<RequestActor> {
  const issuer = process.env.OIDC_ISSUER?.trim();
  const audience = process.env.OIDC_AUDIENCE?.trim();
  const jwksUrl = process.env.OIDC_JWKS_URL?.trim();

  if (issuer == null || audience == null || jwksUrl == null) {
    throw new Error("OIDC authentication is not configured.");
  }

  const verified = await jwtVerify(token, getJwks(jwksUrl), { issuer, audience });
  const claims = verified.payload as AuthClaims;
  const subject = typeof claims.sub === "string" ? claims.sub : null;
  const role = mapRole(claims);
  const organizationId = mapOrganizationId(claims);

  if (subject == null || role == null || organizationId == null) {
    throw new Error("OIDC token is missing subject, role, or organization context.");
  }

  return { id: subject, role, organizationId, demo: false };
}

function demoActor(request: Request): RequestActor | null {
  const requestedDemoUser = request.header("x-agentshield-demo-user");
  if (requestedDemoUser == null) return null;
  const user = demoUsers[requestedDemoUser as keyof typeof demoUsers];
  if (user == null) return null;
  return { ...user, organizationId: "demo-organization", demo: true };
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissions[role].has(permission);
}

export function canIndependentlyApprove(actor: RequestActor, requestedBy: string): boolean {
  return hasPermission(actor.role, "approval:review") && actor.id !== requestedBy;
}

export function getActor(response: Response): RequestActor {
  const actor = response.locals.actor as RequestActor | undefined;
  if (actor == null) throw new Error("Authenticated actor is required.");
  return actor;
}

export function getCorrelationId(response: Response): string {
  const value = response.getHeader("x-correlation-id");
  return typeof value === "string" ? value : "unknown";
}

async function populateRequestContext(request: Request, response: Response): Promise<void> {
  try {
    const bearer = getBearerToken(request);
    if (bearer != null) {
      response.locals.actor = await verifyOidcToken(bearer);
    } else if (isDemoAuthEnabled()) {
      const actor = demoActor(request);
      if (actor == null) {
        response.locals.failureCode = "AUTHENTICATION_REQUIRED";
      } else {
        response.locals.actor = actor;
      }
    } else {
      response.locals.failureCode = "AUTHENTICATION_REQUIRED";
    }
  } catch {
    response.locals.failureCode = "AUTHENTICATION_FAILED";
  }
}

export const requestContext: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const suppliedCorrelation = request.header("x-correlation-id");
  const correlationId =
    suppliedCorrelation != null && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedCorrelation)
      ? suppliedCorrelation
      : randomUUID();
  response.locals.correlationId = correlationId;
  response.setHeader("x-correlation-id", correlationId);
  void populateRequestContext(request, response).then(() => next());
};

export function requirePermission(permission: Permission): RequestHandler {
  return (_request, response, next) => {
    const actor = response.locals.actor as RequestActor | undefined;
    if (actor == null) {
      response.status(401).json({
        error: {
          code:
            typeof (response.locals.failureCode as unknown) === "string"
              ? (response.locals.failureCode as string)
              : "AUTHENTICATION_REQUIRED",
          message: "A verified authenticated session is required.",
          correlationId: getCorrelationId(response),
        },
      });
      return;
    }

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

export function isOidcConfigured(): boolean {
  return (
    process.env.AUTH_MODE === "oidc" &&
    process.env.OIDC_ISSUER != null &&
    process.env.OIDC_AUDIENCE != null &&
    process.env.OIDC_JWKS_URL != null
  );
}

export function isAuthenticationConfigured(): boolean {
  return isOidcConfigured() || isDemoAuthEnabled();
}
