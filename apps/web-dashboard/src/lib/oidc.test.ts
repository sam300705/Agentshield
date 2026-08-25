import { webcrypto } from "node:crypto";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFetchTokenClient,
  OidcSession,
  readOidcConfig,
  type OidcConfig,
  type OidcTokenClient,
} from "./oidc";

const config: OidcConfig = {
  issuer: "https://issuer.test",
  clientId: "agentshield-web",
  redirectUri: "https://dashboard.test/callback",
  authorizationEndpoint: "https://issuer.test/authorize",
  tokenEndpoint: "https://issuer.test/token",
  jwksUri: "https://issuer.test/.well-known/jwks.json",
  endSessionEndpoint: "https://issuer.test/logout",
  scopes: ["openid", "profile"],
  audience: "agentshield-api",
};

const futureClaims = (nonce: string) => ({
  issuer: config.issuer,
  audience: config.clientId,
  nonce,
  subject: "user-1",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider-neutral OIDC session", () => {
  it("builds an authorization-code PKCE URL without persisting tokens", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const client: OidcTokenClient = {
      exchangeCode: vi.fn(),
      refresh: vi.fn(),
    };
    const session = new OidcSession(config, client);
    const loginUrl = await session.beginLogin();
    const params = new URL(loginUrl).searchParams;

    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(params.get("nonce")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.isAuthenticated()).toBe(false);
  });

  it("verifies a standard signed ID token from the configured JWKS endpoint", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "key-1";
    const nonce = "signed-token-nonce";
    const idToken = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer(config.issuer)
      .setAudience(config.clientId)
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === config.tokenEndpoint) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "access-token", expires_in: 3600, id_token: idToken }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ keys: [publicJwk] }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokenClient = createFetchTokenClient(config);

    const tokens = await tokenClient.exchangeCode({
      code: "authorization-code",
      codeVerifier: "verifier",
      redirectUri: config.redirectUri,
      clientId: config.clientId,
      nonce,
    });

    expect(tokens.idToken).toBe(idToken);
    expect(tokens.idTokenClaims).toMatchObject({
      issuer: config.issuer,
      audience: config.clientId,
      nonce,
      subject: "user-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("restores a pending transaction after a page reload and removes it after callback", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const storage = new Map<string, string>();
    const browserStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    };
    const exchangeCode = vi.fn<OidcTokenClient["exchangeCode"]>(() =>
      Promise.resolve({
        accessToken: "access-token",
        expiresAt: Date.now() + 60_000,
        idTokenClaims: futureClaims("pending-nonce"),
      }),
    );
    const client: OidcTokenClient = { exchangeCode, refresh: vi.fn() };
    const firstSession = new OidcSession(config, client, () => Date.now(), browserStorage);
    const loginUrl = await firstSession.beginLogin();
    const params = new URL(loginUrl).searchParams;
    const reloadedSession = new OidcSession(config, client, () => Date.now(), browserStorage);
    const callback = new URL(config.redirectUri);
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", params.get("state") ?? "");
    exchangeCode.mockImplementationOnce(() =>
      Promise.resolve({
        accessToken: "access-token",
        expiresAt: Date.now() + 60_000,
        idTokenClaims: futureClaims(params.get("nonce") ?? ""),
      }),
    );

    await reloadedSession.handleCallback(callback.toString());
    const exchangeInput = exchangeCode.mock.calls[0]?.[0];
    expect(exchangeInput).toMatchObject({
      code: "authorization-code",
      redirectUri: config.redirectUri,
      clientId: config.clientId,
      nonce: params.get("nonce"),
    });
    expect(exchangeInput?.codeVerifier).toEqual(expect.any(String));
    expect(storage.size).toBe(0);
  });

  it("rejects and clears expired persisted transactions", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const storage = new Map<string, string>();
    const browserStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    };
    const exchangeCode = vi.fn<OidcTokenClient["exchangeCode"]>();
    const client: OidcTokenClient = { exchangeCode, refresh: vi.fn() };
    const firstSession = new OidcSession(config, client, () => 1_000, browserStorage);
    const loginUrl = await firstSession.beginLogin();
    const state = new URL(loginUrl).searchParams.get("state") ?? "";
    const reloadedSession = new OidcSession(config, client, () => 601_001, browserStorage);
    const callback = new URL(config.redirectUri);
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", state);

    await expect(reloadedSession.handleCallback(callback.toString())).rejects.toThrow(
      "transaction expired",
    );
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it("validates callback state and nonce before accepting tokens", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const client: OidcTokenClient = {
      exchangeCode: vi.fn(() =>
        Promise.resolve({
          accessToken: "access-token",
          expiresAt: Date.now() + 60_000,
          idToken: "id-token",
          idTokenClaims: futureClaims("wrong-nonce"),
        }),
      ),
      refresh: vi.fn(),
    };
    const session = new OidcSession(config, client);
    const loginUrl = await session.beginLogin();
    const loginParams = new URL(loginUrl).searchParams;
    const callback = new URL(config.redirectUri);
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set("state", loginParams.get("state") ?? "");

    await expect(session.handleCallback(callback.toString())).rejects.toThrow(
      "nonce validation failed",
    );
    expect(session.isAuthenticated()).toBe(false);

    const secondLoginUrl = await session.beginLogin();
    const secondParams = new URL(secondLoginUrl).searchParams;
    const secondCallback = new URL(config.redirectUri);
    secondCallback.searchParams.set("code", "authorization-code");
    secondCallback.searchParams.set("state", secondParams.get("state") ?? "");
    client.exchangeCode = vi.fn(() =>
      Promise.resolve({
        accessToken: "access-token",
        expiresAt: Date.now() + 60_000,
        idToken: "id-token",
        idTokenClaims: futureClaims(secondParams.get("nonce") ?? ""),
      }),
    );

    await session.handleCallback(secondCallback.toString());
    expect(await session.getAccessToken()).toBe("access-token");
  });

  it("refreshes expired access tokens in memory and clears on refresh failure", async () => {
    vi.stubGlobal("crypto", webcrypto);
    let now = 1_000_000;
    const refreshMock = vi.fn(() =>
      Promise.resolve({
        accessToken: "refreshed-token",
        expiresAt: now + 60_000,
        refreshToken: "refresh-token-2",
        idToken: "id-token-2",
        idTokenClaims: futureClaims("refresh"),
      }),
    );
    const client: OidcTokenClient = {
      exchangeCode: vi.fn(),
      refresh: refreshMock,
    };
    const session = new OidcSession(config, client, () => now);
    const loginUrl = await session.beginLogin();
    const params = new URL(loginUrl).searchParams;
    client.exchangeCode = vi.fn(() =>
      Promise.resolve({
        accessToken: "expired-token",
        expiresAt: now + 1,
        refreshToken: "refresh-token",
        idTokenClaims: futureClaims(params.get("nonce") ?? ""),
      }),
    );
    const callback = new URL(config.redirectUri);
    callback.searchParams.set("code", "code");
    callback.searchParams.set("state", params.get("state") ?? "");
    await session.handleCallback(callback.toString());
    now += 5_000;

    expect(await session.getAccessToken()).toBe("refreshed-token");
    expect(refreshMock).toHaveBeenCalledWith({
      refreshToken: "refresh-token",
      clientId: config.clientId,
    });
    const logoutUrl = session.logout();
    expect(logoutUrl).toContain("id_token_hint");
    expect(session.isAuthenticated()).toBe(false);
  });

  it("returns no live configuration when required owner values are absent", () => {
    expect(readOidcConfig({ VITE_APP_MODE: "demo" })).toBeNull();
    expect(
      readOidcConfig({ VITE_APP_MODE: "live", VITE_OIDC_ISSUER: "https://issuer.test" }),
    ).toBeNull();
    expect(
      readOidcConfig({
        VITE_APP_MODE: "live",
        VITE_OIDC_ISSUER: config.issuer,
        VITE_OIDC_CLIENT_ID: config.clientId,
        VITE_OIDC_REDIRECT_URI: config.redirectUri,
        VITE_OIDC_AUTHORIZATION_ENDPOINT: config.authorizationEndpoint,
        VITE_OIDC_TOKEN_ENDPOINT: config.tokenEndpoint,
        VITE_OIDC_JWKS_URI: config.jwksUri,
      }),
    ).toMatchObject({ issuer: config.issuer, clientId: config.clientId });
  });
});
