import { createServer as httpServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) }));
vi.mock("./db/prisma.js", () => ({ prisma: database }));
import { createServer } from "./server.js";
import { observeRequest } from "./observability.js";
import { reportError } from "./errorReporter.js";

const servers: Server[] = [];
async function start(app: express.Express): Promise<string> {
  const server = httpServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  database.$queryRaw.mockResolvedValue([{ ok: 1 }]);
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});
function localConfig(): void {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DEMO_AUTH_ENABLED", "true");
  vi.stubEnv("DATABASE_URL", "postgresql://app:synthetic@localhost/db");
  vi.stubEnv("RATE_LIMIT_ENABLED", "false");
}
describe("production runtime boundaries", () => {
  it("keeps live health up but marks readiness unavailable on database failure", async () => {
    localConfig();
    const origin = await start(createServer());
    database.$queryRaw.mockRejectedValue(new Error("private connection details"));
    expect((await fetch(`${origin}/health/live`)).status).toBe(200);
    const response = await fetch(`${origin}/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private connection details");
  });
  it("adds security headers, validated correlation and redacts HTTP log input", async () => {
    localConfig();
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const origin = await start(createServer());
    const response = await fetch(`${origin}/missing?secret=synthetic-sensitive`, {
      headers: {
        "x-correlation-id": "safe-request-1",
        Authorization: "Bearer synthetic-sensitive",
      },
    });
    expect(response.headers.get("x-correlation-id")).toBe("safe-request-1");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src");
    expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-sensitive");
    expect(JSON.stringify(log.mock.calls)).toContain("safe-request-1");
  });
  it("does not expose process metrics to a tenant identity without the separate platform token", async () => {
    localConfig();
    vi.stubEnv("METRICS_TOKEN", "x".repeat(32));
    const origin = await start(createServer());
    expect(
      (await fetch(`${origin}/ops/metrics`, { headers: { "x-agentshield-demo-user": "admin" } }))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(`${origin}/ops/metrics`, {
          headers: { Authorization: `Bearer ${"x".repeat(32)}` },
        })
      ).status,
    ).toBe(200);
  });
  it("fails closed on Redis outages while health probes bypass protection", async () => {
    localConfig();
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("REDIS_REST_URL", "https://redis.example.com");
    vi.stubEnv("REDIS_REST_TOKEN", "synthetic");
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input, init) =>
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).startsWith("https://redis.example.com")
          ? Promise.reject(new Error("secret upstream details"))
          : realFetch(input, init),
      ),
    );
    const origin = await start(createServer());
    expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
    const response = await fetch(`${origin}/api/v1/repositories`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret upstream details");
  });
  it("reports only an allowlisted error envelope and ignores collector failures", async () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://collector.example.com");
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("upstream failed"));
    vi.stubGlobal("fetch", send);
    reportError({
      service: "agentshield-api",
      code: "HTTP_5XX",
      correlationId: "bad\nvalue",
      traceId: "private source data",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const body = send.mock.calls[0]?.[1]?.body;
    expect(typeof body === "string" ? JSON.parse(body) : null).toEqual({
      service: "agentshield-api",
      code: "HTTP_5XX",
    });
  });
  it("accepts W3C trace IDs without putting user URLs into telemetry", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = express();
    app.use(observeRequest);
    app.get("/", (_req, res) => res.end());
    const origin = await start(app);
    const traceId = "1".repeat(32);
    await fetch(`${origin}/?private=value`, {
      headers: { traceparent: `00-${traceId}-${"2".repeat(16)}-01` },
    });
    expect(JSON.stringify(log.mock.calls)).toContain(traceId);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private=value");
  });
});
