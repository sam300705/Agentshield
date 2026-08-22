import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { configureApiAuth } from "./auth";

afterEach(() => {
  configureApiAuth(null);
  vi.unstubAllGlobals();
});

describe("dashboard API client", () => {
  it("adds a memory-only bearer token and omits cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ totalScans: 0 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    configureApiAuth({ getAccessToken: () => "test-token" });

    await api.getDashboardSummary();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(init.credentials).toBe("omit");
  });

  it("exposes sanitized 401 errors and invokes the unauthorized callback", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in is required." },
          }),
          { status: 401 },
        ),
      ),
    );
    configureApiAuth({ getAccessToken: () => null, onUnauthorized });

    await expect(api.getDashboardSummary()).rejects.toMatchObject({
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Sign in is required.",
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("invokes the forbidden callback without exposing response internals", async () => {
    const onForbidden = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 403 })),
    );
    configureApiAuth({ getAccessToken: () => null, onForbidden });

    const error = await api.getDashboardSummary().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: null });
    expect((error as Error).message).toBe("API request failed with status 403.");
    expect(onForbidden).toHaveBeenCalledOnce();
  });
});
