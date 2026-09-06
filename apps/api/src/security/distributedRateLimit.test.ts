import { createServer, type Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDistributedRateLimiter,
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from "./distributedRateLimit.js";

const servers: Server[] = [];

async function start(app: express.Express): Promise<{ origin: string }> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Test server did not bind.");
  return { origin: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error == null ? resolve() : reject(error))),
          ),
      ),
  );
});

describe("distributed rate limiter", () => {
  it("uses Redis-compatible atomic increment and expiry commands", async () => {
    const client = {
      incr: vi.fn().mockResolvedValue(2),
      pExpire: vi.fn().mockResolvedValue(true),
      pTtl: vi.fn().mockResolvedValue(30_000),
    };
    const store = new RedisRateLimitStore(client);

    await expect(store.increment("org:user", 60_000)).resolves.toMatchObject({ count: 2 });
    expect(client.incr).toHaveBeenCalledWith("org:user");
    expect(client.pExpire).not.toHaveBeenCalled();
    expect(client.pTtl).toHaveBeenCalledWith("org:user");
  });

  it("applies a shared store and standard headers", async () => {
    const store = new InMemoryRateLimitStore();
    const app = express();
    app.use(
      createDistributedRateLimiter({
        enabled: true,
        max: 1,
        windowMs: 60_000,
        store,
        keyForRequest: (request) => String(request.headers["x-org"] ?? "unknown"),
      }),
    );
    app.get("/health", (_request, response) => response.json({ ok: true }));
    const { origin } = await start(app);

    const first = await fetch(`${origin}/health`, { headers: { "x-org": "org-a" } });
    const second = await fetch(`${origin}/health`, { headers: { "x-org": "org-a" } });
    const otherOrganization = await fetch(`${origin}/health`, { headers: { "x-org": "org-b" } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("ratelimit-limit")).toBe("1");
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
    expect(otherOrganization.status).toBe(200);
  });

  it("fails closed on store outages unless fail-open is explicit", async () => {
    const failingStore: RateLimitStore = {
      increment: vi.fn().mockRejectedValue(new Error("storage offline")),
    };
    const closed = express();
    closed.use(
      createDistributedRateLimiter({
        enabled: true,
        max: 10,
        windowMs: 60_000,
        store: failingStore,
      }),
    );
    closed.get("/health", (_request, response) => response.json({ ok: true }));
    const closedOrigin = await start(closed);
    expect((await fetch(`${closedOrigin.origin}/health`)).status).toBe(503);

    const open = express();
    open.use(
      createDistributedRateLimiter({
        enabled: true,
        max: 10,
        windowMs: 60_000,
        store: failingStore,
        onStoreError: "fail-open",
      }),
    );
    open.get("/health", (_request, response) => response.json({ ok: true }));
    const openOrigin = await start(open);
    expect((await fetch(`${openOrigin.origin}/health`)).status).toBe(200);
  });
});
