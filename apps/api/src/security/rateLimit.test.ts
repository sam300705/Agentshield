import { createServer, type Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createRateLimiter } from "./rateLimit.js";

const servers: Server[] = [];

async function start(app: express.Express): Promise<{ origin: string; server: Server }> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Test server did not bind.");
  return { origin: `http://127.0.0.1:${address.port}`, server };
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

describe("rate limiter", () => {
  it("rejects requests over the configured limit", async () => {
    const app = express();
    app.use(createRateLimiter({ enabled: true, max: 1, windowMs: 60_000 }));
    app.get("/health", (_request, response) => response.json({ ok: true }));
    const { origin } = await start(app);

    const first = await fetch(`${origin}/health`);
    const second = await fetch(`${origin}/health`);

    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("1");
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("passes through every request when disabled", async () => {
    const app = express();
    app.use(createRateLimiter({ enabled: false, max: 1, windowMs: 60_000 }));
    app.get("/health", (_request, response) => response.json({ ok: true }));
    const { origin } = await start(app);

    const responses = await Promise.all([fetch(`${origin}/health`), fetch(`${origin}/health`)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
  });
});
