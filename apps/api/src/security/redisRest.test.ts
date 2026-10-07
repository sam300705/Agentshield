import { describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_SCRIPT, RedisRestRateLimitStore } from "./redisRest.js";

describe("production Redis REST boundary", () => {
  it("sends a single atomic bounded EVAL without redirects or retries", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ result: [2, 5000] })));
    const store = new RedisRestRateLimitStore("https://redis.example.com", "synthetic", fetchImpl);
    expect((await store.increment("hashed-key", 6000)).count).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const options = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(typeof options?.body === "string" ? options.body : "null")).toEqual([
      "EVAL",
      RATE_LIMIT_SCRIPT,
      "1",
      "hashed-key",
      "6000",
    ]);
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    new Response("private upstream details", { status: 503 }),
    new Response('{"result":[1,-1]}'),
    new Response("bad json"),
  ])("rejects outages and invalid counter/TTL envelopes", async (response) => {
    const store = new RedisRestRateLimitStore(
      "https://redis.example.com",
      "synthetic",
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    await expect(store.increment("key", 6000)).rejects.toThrow();
  });
});
