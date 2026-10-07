import { generateKeyPairSync } from "node:crypto";
import { jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { FetchGitHubAppClient, validateGitHubPrivateKey } from "./githubApiClient.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
const config = { appId: "123", webhookSecret: "synthetic", privateKey: pem };
const sha = "a".repeat(40);

describe("GitHub API authentication and transport", () => {
  it("signs GitHub's downloaded PKCS1 key with RS256 and bounded skew/expiry", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const jwt = headers.get("authorization")!.slice(7);
      const { payload, protectedHeader } = await jwtVerify(jwt, publicKey, { issuer: "123" });
      expect(protectedHeader.alg).toBe("RS256");
      expect(payload.exp! - payload.iat!).toBe(540);
      expect(headers.get("user-agent")).toBe("AgentShield");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.redirect).toBe("error");
      return Response.json({
        token: "synthetic-installation-credential",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
    });
    const client = new FetchGitHubAppClient(
      { ...config, privateKey: pem.replaceAll("\n", "\\n") },
      { fetchImpl },
    );
    expect((await client.createInstallationToken(42)).expiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("normalizes malformed keys without echoing credentials", () => {
    expect(() => validateGitHubPrivateKey("sensitive-invalid-key")).toThrow(
      "GITHUB_PRIVATE_KEY_INVALID",
    );
    expect(
      () => new FetchGitHubAppClient(config, { apiBaseUrl: "http://internal.example" }),
    ).toThrow("GITHUB_API_ORIGIN_INVALID");
  });
  it.each([401, 403, 404, 422])(
    "does not retry authorization/validation status %s or expose response",
    async (status) => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(new Response("provider-sensitive-value", { status })),
      );
      const client = new FetchGitHubAppClient(config, { fetchImpl });
      await expect(client.getRepository("octo", "example", "synthetic")).rejects.toThrow(
        `(${status})`,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("honors a bounded Retry-After and retries a transient read", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(
        Response.json({
          id: 123,
          full_name: "octo/example",
          private: true,
          default_branch: "main",
        }),
      );
    expect(
      (
        await new FetchGitHubAppClient(config, { fetchImpl }).getRepository(
          "octo",
          "example",
          "synthetic",
        )
      ).id,
    ).toBe(123);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("follows only the GitHub archive redirect and drops Authorization", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://codeload.github.com/octo/example/legacy.tar.gz/${sha}` },
        }),
      )
      .mockResolvedValueOnce(new Response("archive"));
    await new FetchGitHubAppClient(config, { fetchImpl }).downloadRepositoryArchive(
      "octo",
      "example",
      sha,
      "synthetic",
      new AbortController().signal,
    );
    const redirected = fetchImpl.mock.calls[1]![1] as RequestInit;
    expect(new Headers(redirected.headers).has("authorization")).toBe(false);
    expect(redirected.redirect).toBe("error");
  });
  it.each([
    "http://codeload.github.com/octo/example/a",
    "https://internal.example/archive",
    "https://codeload.github.com/other/repo/a",
    "https://codeload.github.com:444/octo/example/a",
  ])("rejects archive redirect %s", async (location) => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location } })),
    );
    await expect(
      new FetchGitHubAppClient(config, { fetchImpl }).downloadRepositoryArchive(
        "octo",
        "example",
        sha,
        "synthetic",
        new AbortController().signal,
      ),
    ).rejects.toThrow("GITHUB_ARCHIVE_REDIRECT_REJECTED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
