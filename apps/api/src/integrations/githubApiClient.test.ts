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
        token: ["synthetic", "installation", "credential"].join("-"),
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

describe("repository-scoped execution credentials", () => {
  it.each([
    ["SCAN", { contents: "read", metadata: "read" }],
    ["CHECK_PUBLICATION", { checks: "write", metadata: "read" }],
  ] as const)(
    "requests only the immutable repository and %s permissions",
    async (purpose, permissions) => {
      const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
        const body = init?.body;
        if (typeof body !== "string") throw new Error("Expected a JSON token-scope body");
        expect(JSON.parse(body)).toEqual({ repository_ids: [123], permissions });
        return Promise.resolve(
          Response.json({
            token: ["synthetic", "scoped"].join("-"),
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          }),
        );
      });
      await new FetchGitHubAppClient(config, { fetchImpl }).createInstallationToken(42, {
        repositoryId: "123",
        purpose,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["9007199254740993", "00123", "123e0"])(
    "rejects an unsupported or ambiguous repository ID %s before HTTP",
    async (repositoryId) => {
      const fetchImpl = vi.fn();
      await expect(
        new FetchGitHubAppClient(config, { fetchImpl }).createInstallationToken(42, {
          repositoryId,
          purpose: "CHECK_PUBLICATION",
        }),
      ).rejects.toThrow("GITHUB_TOKEN_SCOPE_INVALID");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe("Check update and reconciliation identity", () => {
  it("keeps the commit in the create context but omits create-only head_sha from PATCH", async () => {
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("PATCH");
      const body = init?.body;
      if (typeof body !== "string") throw new Error("Expected update JSON");
      const parsed = JSON.parse(body) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("head_sha");
      expect(parsed.external_id).toBe("exact-scan");
      return Promise.resolve(Response.json({ id: 123 }));
    });
    await new FetchGitHubAppClient(config, { fetchImpl })
      .withInstallationToken("synthetic")
      .updateCheckRun(123, {
        owner: "octo",
        repository: "example",
        name: "AgentShield Security",
        headSha: sha,
        externalId: "exact-scan",
        status: "completed",
        conclusion: "success",
        output: { title: "Complete", summary: "Complete evidence" },
      });
  });
  it("refuses multiple matching external identities across pages instead of choosing one", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          check_runs: Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            external_id: index === 0 ? "exact-scan" : `other-${index}`,
          })),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ check_runs: [{ id: 999, external_id: "exact-scan" }] }),
      );
    await expect(
      new FetchGitHubAppClient(config, { fetchImpl })
        .withInstallationToken("synthetic")
        .findCheckRun("octo", "example", sha, "exact-scan"),
    ).rejects.toThrow("GITHUB_CHECK_IDENTITY_AMBIGUOUS");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("created Check identity binding", () => {
  it.each(["external_id", "head_sha"])(
    "rejects a successful response with mismatched %s",
    async (field) => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              id: 123,
              external_id: "exact-scan",
              head_sha: sha,
              [field]: "wrong-context",
            },
            { status: 201 },
          ),
        ),
      );
      await expect(
        new FetchGitHubAppClient(config, { fetchImpl })
          .withInstallationToken("synthetic")
          .createCheckRun({
            owner: "octo",
            repository: "example",
            name: "AgentShield Security",
            headSha: sha,
            externalId: "exact-scan",
            status: "queued",
            output: { title: "Queued", summary: "Pending evidence" },
          }),
      ).rejects.toThrow("GITHUB_CHECK_IDENTITY_MISMATCH");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
});
