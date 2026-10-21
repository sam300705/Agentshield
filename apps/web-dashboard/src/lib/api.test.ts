import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { configureApiAuth } from "./auth";

afterEach(() => {
  configureApiAuth(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dashboard API client", () => {
  it("adds a memory-only bearer token and omits cookies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ totalScans: 0 }), { status: 200 }));
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 403 })));
    configureApiAuth({ getAccessToken: () => null, onForbidden });

    const error = await api.getDashboardSummary().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: null });
    expect((error as Error).message).toBe("API request failed with status 403.");
    expect(onForbidden).toHaveBeenCalledOnce();
  });
});

it.each([
  undefined,
  "",
  "http://localhost:3001",
  "http://api.example.test",
  "https://user:pass@api.example.test",
  "https://api.example.test/?token=value",
])("refuses invalid live API configuration before token retrieval or fetch", async (origin) => {
  vi.stubEnv("VITE_APP_MODE", "live");
  vi.stubEnv("VITE_API_BASE_URL", origin);
  const fetchMock = vi.fn();
  const token = vi.fn(() => "memory-token");
  vi.stubGlobal("fetch", fetchMock);
  configureApiAuth({ getAccessToken: token });
  await expect(api.getDashboardSummary()).rejects.toThrow();
  expect(token).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("uses only the validated HTTPS API origin in live mode", async () => {
  vi.stubEnv("VITE_APP_MODE", "live");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test/");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  configureApiAuth({ getAccessToken: () => "memory-token" });
  await api.getDashboardSummary();
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/api/dashboard/summary");
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", credentials: "omit" });
});

it("sends agent review to its existing endpoint with the exact displayed digest", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  await api.reviewAgentApproval("approval/one", "approve", "Independent review", "a".repeat(64));
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/api/v1/agent/approvals/approval%2Fone/approve");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({
    reason: "Independent review",
    expectedActionDigest: "a".repeat(64),
  });
});
