import { createServer, type Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDistributedRateLimiter,
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  RedisRestRateLimitClient,
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

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(init: RequestInit | undefined): unknown[] {
  const body = init?.body;
  if (typeof body !== "string")
    throw new Error("Expected Redis REST request body to be JSON text.");
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error("Expected Redis REST command body to be an array.");
  return parsed;
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
  it("delegates each window increment to one atomic Redis operation", async () => {
    const incrementWindow = vi.fn(() =>
      Promise.resolve({ count: 2, resetAt: Date.now() + 30_000 }),
    );
    const store = new RedisRateLimitStore({ incrementWindow });

    await expect(store.increment("org:user", 60_000)).resolves.toMatchObject({ count: 2 });
    expect(incrementWindow).toHaveBeenCalledTimes(1);
    expect(incrementWindow).toHaveBeenCalledWith("org:user", 60_000);
  });

  it("executes one authenticated EVAL command that owns increment and expiry atomically", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      expect(url).toBe("https://redis.example.test");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-token");
      expect(url).not.toContain("private-token");
      const command = requestBody(init);
      expect(command[0]).toBe("EVAL");
      expect(typeof command[1]).toBe("string");
      expect(command[2]).toBe(1);
      expect(command[3]).toBe("organization:1");
      expect(command[4]).toBe(60_000);
      return Promise.resolve(
        new Response(JSON.stringify({ result: [3, 42_000] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new RedisRestRateLimitClient(
      "https://redis.example.test/",
      "private-token",
      fetchImpl,
    );
    const store = new RedisRateLimitStore(client);

    await expect(store.increment("organization:1", 60_000)).resolves.toMatchObject({ count: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed atomic Redis results", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: [2, -1] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new RedisRestRateLimitClient("https://redis.example.test", "t", fetchImpl);

    await expect(client.incrementWindow("organization:1", 60_000)).rejects.toThrow(
      "invalid atomic rate-limit result",
    );
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
