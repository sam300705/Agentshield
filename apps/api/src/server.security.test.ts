import { createServer as httpServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";
import type * as Authentication from "./security/auth.js";
const authentication = vi.hoisted(() => vi.fn<RequestHandler>());
vi.mock("./security/auth.js", async (importOriginal) => {
  const original = await importOriginal<typeof Authentication>();
  return { ...original, requestContext: authentication };
});
import { createServer } from "./server.js";
let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  authentication.mockReset();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});
async function start(proxy: string) {
  vi.stubEnv("DATABASE_URL", "postgresql://local:synthetic@localhost/test");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "true");
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
  vi.stubEnv("RATE_LIMIT_MAX", "1");
  vi.stubEnv("TRUSTED_PROXY_CIDRS", proxy);
  authentication.mockImplementation((_req, res) =>
    res.status(401).json({ error: "invalid bearer" }),
  );
  server = httpServer(createServer());
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server");
  return `http://127.0.0.1:${address.port}`;
}
it("rejects exhausted IP budgets before authentication and ignores untrusted forwarding", async () => {
  const origin = await start("");
  expect(
    (await fetch(origin + "/api/scans/a", { headers: { "x-forwarded-for": "192.0.2.1" } })).status,
  ).toBe(401);
  expect(
    (await fetch(origin + "/api/scans/b", { headers: { "x-forwarded-for": "192.0.2.2" } })).status,
  ).toBe(429);
  expect(authentication).toHaveBeenCalledTimes(1);
});
it("isolates clients through an explicitly trusted proxy and ignores spoofed leftmost hops", async () => {
  const origin = await start("127.0.0.1/32");
  async function request(forwarded: string) {
    return (await fetch(origin + "/api/scans/a", { headers: { "x-forwarded-for": forwarded } }))
      .status;
  }
  expect(await request("192.0.2.1")).toBe(401);
  expect(await request("192.0.2.2")).toBe(401);
  expect(await request("198.51.100.9, 192.0.2.1")).toBe(429);
  expect(authentication).toHaveBeenCalledTimes(2);
});

it.each([
  ["/api/scans", "{synthetic-private-body", 400, "VALIDATION_ERROR"],
  ["/api/scans", '"' + "x".repeat(1024 * 1024) + '"', 413, "PAYLOAD_TOO_LARGE"],
  ["/api/v1/integrations/github/webhooks", "x".repeat(1024 * 1024 + 1), 413, "PAYLOAD_TOO_LARGE"],
])("returns a safe parser error for %s", async (path, body, status, code) => {
  const origin = await start("");
  authentication.mockImplementation((_req, _res, next) => next());
  const response = await fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  expect(response.status).toBe(status);
  const payload = (await response.json()) as { error: { code: string } };
  expect(payload.error.code).toBe(code);
  expect(JSON.stringify(payload)).not.toContain("synthetic-private-body");
});
