import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestContext, requirePermission } from "./auth.js";

let server: Server | undefined;
let baseUrl: string;
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "true");
  const app = express();
  app.use(requestContext);
  app.get("/protected", requirePermission("scan:read"), (_request, response) =>
    response.json({ ok: true }),
  );
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Missing test address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (server != null)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  vi.unstubAllEnvs();
});

describe("authentication boundary", () => {
  it("accepts only explicitly configured own demo identities", async () => {
    expect(
      (await fetch(`${baseUrl}/protected`, { headers: { "x-agentshield-demo-user": "viewer" } }))
        .status,
    ).toBe(200);
    for (const name of ["constructor", "toString", "__proto__", "unconfigured"]) {
      expect(
        (await fetch(`${baseUrl}/protected`, { headers: { "x-agentshield-demo-user": name } }))
          .status,
      ).toBe(401);
    }
  });
  it("never downgrades malformed or invalid authorization to demo", async () => {
    for (const authorization of ["Basic invalid", "Bearer", "Bearer invalid"]) {
      expect(
        (
          await fetch(`${baseUrl}/protected`, {
            headers: { authorization, "x-agentshield-demo-user": "viewer" },
          })
        ).status,
      ).toBe(401);
    }
  });
  it("rejects demo identities in production even if the flag is supplied", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      (await fetch(`${baseUrl}/protected`, { headers: { "x-agentshield-demo-user": "admin" } }))
        .status,
    ).toBe(401);
  });
});
