import express from "express";
import type { Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getActor, requestContext, requirePermission } from "./auth.js";

const tenantClaim = "https://agentshield.example/organization_id";
const roleClaim = "https://agentshield.example/roles";
let servers: Server[] = [];
let apiUrl: string;
let issuer: string;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;

async function listen(app: ReturnType<typeof express>): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  servers.push(server);
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Missing test address");
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  pair = await generateKeyPair("RS256");
  const key = { ...(await exportJWK(pair.publicKey)), kid: "tenant-test", alg: "RS256" };
  const jwks = express();
  jwks.get("/keys", (_request, response) => response.json({ keys: [key] }));
  issuer = await listen(jwks);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "false");
  vi.stubEnv("OIDC_ISSUER", issuer);
  vi.stubEnv("OIDC_AUDIENCE", "tenant-test-api");
  vi.stubEnv("OIDC_JWKS_URL", `${issuer}/keys`);
  vi.stubEnv("OIDC_ROLE_CLAIM", roleClaim);
  vi.stubEnv("OIDC_TENANT_CLAIM", tenantClaim);
  const app = express();
  app.use(requestContext);
  app.get("/actor", requirePermission("scan:read"), (_request, response) =>
    response.json(getActor(response)),
  );
  app.get("/developer", requirePermission("scan:run"), (_request, response) =>
    response.json(getActor(response)),
  );
  apiUrl = await listen(app);
});

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  servers = [];
  vi.unstubAllEnvs();
});

async function request(
  claims: Record<string, unknown>,
  tokenIssuer = issuer,
  options: {
    audience?: string;
    expiration?: string;
    signer?: typeof pair.privateKey;
    path?: string;
  } = {},
) {
  const token = await new SignJWT({ [roleClaim]: ["VIEWER"], ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "tenant-test" })
    .setSubject("auth0|synthetic-user")
    .setIssuer(tokenIssuer)
    .setAudience(options.audience ?? "tenant-test-api")
    .setIssuedAt()
    .setExpirationTime(options.expiration ?? "5m")
    .sign(options.signer ?? pair.privateKey);
  return fetch(`${apiUrl}${options.path ?? "/actor"}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

it("derives the tenant exclusively from the configured signed claim", async () => {
  const response = await request({ [tenantClaim]: "staging-tenant", organization_id: "other" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    id: "auth0|synthetic-user",
    role: "VIEWER",
    organizationId: "staging-tenant",
    demo: false,
  });
});

it("rejects missing or malformed configured tenants despite valid legacy aliases", async () => {
  for (const value of [undefined, "", "bad tenant", "x".repeat(129), ["tenant"], 42, {}]) {
    const response = await request({
      [tenantClaim]: value,
      organization_id: "legacy-a",
      organizationId: "legacy-b",
      org_id: "legacy-c",
    });
    expect(response.status).toBe(401);
  }
});

it("retains legacy claim compatibility only when no selector is configured", async () => {
  vi.stubEnv("OIDC_TENANT_CLAIM", "");
  for (const name of ["organization_id", "organizationId", "org_id"]) {
    const response = await request({ [name]: "legacy-tenant" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ organizationId: "legacy-tenant" });
  }
});

it("still requires the trusted issuer and the configured role claim", async () => {
  expect((await request({ [tenantClaim]: "tenant" }, "https://untrusted.example")).status).toBe(
    401,
  );
  expect(
    (await request({ [tenantClaim]: "tenant", [roleClaim]: undefined, roles: ["VIEWER"] })).status,
  ).toBe(401);
});

it("rejects a signed token for another API audience", async () => {
  expect(
    (await request({ [tenantClaim]: "tenant" }, issuer, { audience: "other-api" })).status,
  ).toBe(401);
});

it("rejects an expired signed token with otherwise valid tenant and role claims", async () => {
  expect((await request({ [tenantClaim]: "tenant" }, issuer, { expiration: "-1m" })).status).toBe(
    401,
  );
});

it("rejects a token signed by an untrusted key despite the expected key ID", async () => {
  const untrusted = await generateKeyPair("RS256");
  expect(
    (await request({ [tenantClaim]: "tenant" }, issuer, { signer: untrusted.privateKey })).status,
  ).toBe(401);
});

it("enforces RBAC after verification of namespaced claims", async () => {
  expect(
    (await request({ [tenantClaim]: "tenant-a" }, issuer, { path: "/developer" })).status,
  ).toBe(403);
  const response = await request(
    { [tenantClaim]: "tenant-b", [roleClaim]: ["DEVELOPER"] },
    issuer,
    { path: "/developer" },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ organizationId: "tenant-b", role: "DEVELOPER" });
});
