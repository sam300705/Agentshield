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

const futureClaims = (nonce?: string) => ({
  issuer: config.issuer,
  audience: config.clientId,
  ...(nonce == null ? {} : { nonce }),
  subject: "user-1",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("provider-neutral OIDC session", () => {
  it("accepts a signed refresh ID token without nonce while requiring it on login", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "refresh-key";
    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "refresh-key" })
      .setIssuer(config.issuer)
      .setAudience(config.clientId)
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              url === config.tokenEndpoint
                ? { access_token: "refresh-access", expires_in: 3600, id_token: idToken }
                : { keys: [jwk] },
            ),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      }),
    );
    const client = createFetchTokenClient(config);
    await expect(
      client.refresh({ refreshToken: "synthetic-refresh", clientId: config.clientId }),
    ).resolves.toMatchObject({ idTokenClaims: { subject: "user-1" } });
    await expect(
      client.exchangeCode({
        code: "synthetic",
        codeVerifier: "verifier",
        redirectUri: config.redirectUri,
        clientId: config.clientId,
        nonce: "required-nonce",
      }),
    ).rejects.toThrow();
  });
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
        idTokenClaims: futureClaims(),
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

  it("retains a non-rotated refresh token over successive refreshes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    let now = 1_000_000;
    const refresh = vi.fn(() => Promise.resolve({ accessToken: "new", expiresAt: now + 1 }));
    const client: OidcTokenClient = { exchangeCode: vi.fn(), refresh };
    const session = new OidcSession(config, client, () => now);
    const params = new URL(await session.beginLogin()).searchParams;
    client.exchangeCode = vi.fn(() =>
      Promise.resolve({
        accessToken: "old",
        expiresAt: now + 1,
        refreshToken: "retained",
        idTokenClaims: futureClaims(params.get("nonce") ?? ""),
      }),
    );
    const callback = new URL(config.redirectUri);
    callback.searchParams.set("code", "code");
    callback.searchParams.set("state", params.get("state") ?? "");
    await session.handleCallback(callback.toString());
    now += 5000;
    expect(await session.getAccessToken()).toBe("new");
    now += 5000;
    expect(await session.getAccessToken()).toBe("new");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith({
      refreshToken: "retained",
      clientId: config.clientId,
    });
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

it.each([false, true])(
  "discards a refresh completion after logout (reject=%s)",
  async (rejectRefresh) => {
    vi.stubGlobal("crypto", webcrypto);
    let finish!: (value: { accessToken: string; expiresAt: number }) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<{ accessToken: string; expiresAt: number }>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const client: OidcTokenClient = { exchangeCode: vi.fn(), refresh: vi.fn(() => pending) };
    const session = new OidcSession(config, client);
    async function login(accessToken: string, expiresAt: number) {
      const params = new URL(await session.beginLogin()).searchParams;
      client.exchangeCode = vi.fn(() =>
        Promise.resolve({
          accessToken,
          expiresAt,
          refreshToken: "synthetic-refresh",
          idTokenClaims: futureClaims(params.get("nonce") ?? ""),
        }),
      );
      const callback = new URL(config.redirectUri);
      callback.searchParams.set("code", "code");
      callback.searchParams.set("state", params.get("state") ?? "");
      await session.handleCallback(callback.toString());
    }
    await login("expired", 1);
    const refresh = session.getAccessToken();
    session.logout();
    // A stale success or failure must also leave a subsequently established session intact.
    await login("new-session", Date.now() + 3600000);
    if (rejectRefresh) fail(new Error("old refresh failed"));
    else finish({ accessToken: "stale", expiresAt: Date.now() + 3600000 });
    expect(await refresh).toBeNull();
    expect(await session.getAccessToken()).toBe("new-session");
    session.logout();
    expect(session.isAuthenticated()).toBe(false);
  },
);

it.each([
  "issuer",
  "redirectUri",
  "authorizationEndpoint",
  "tokenEndpoint",
  "jwksUri",
  "endSessionEndpoint",
] as const)("rejects insecure OIDC %s before any token request", (field) => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(() =>
    createFetchTokenClient({ ...config, [field]: "http://provider.example.test/endpoint" }),
  ).toThrow("HTTPS");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("allows only explicit loopback development OIDC HTTP and rejects credential URLs", () => {
  expect(() =>
    createFetchTokenClient({ ...config, tokenEndpoint: "http://localhost:9000/token" }),
  ).toThrow();
  expect(() =>
    createFetchTokenClient({
      ...config,
      allowLoopbackHttp: true,
      tokenEndpoint: "http://localhost:9000/token",
    }),
  ).not.toThrow();
  expect(() =>
    createFetchTokenClient({
      ...config,
      allowLoopbackHttp: true,
      tokenEndpoint: "http://localhost.example.test/token",
    }),
  ).toThrow();
  expect(() =>
    createFetchTokenClient({ ...config, tokenEndpoint: "https://user:password@issuer.test/token" }),
  ).toThrow();
});

it("does not enable loopback HTTP in a production build even with the development flag", () => {
  vi.stubEnv("DEV", false);
  expect(() =>
    createFetchTokenClient({
      ...config,
      allowLoopbackHttp: true,
      tokenEndpoint: "http://localhost:9000/token",
    }),
  ).toThrow("HTTPS");
  expect(
    readOidcConfig({
      VITE_APP_MODE: "live",
      VITE_OIDC_ISSUER: config.issuer,
      VITE_OIDC_CLIENT_ID: config.clientId,
      VITE_OIDC_REDIRECT_URI: config.redirectUri,
      VITE_OIDC_AUTHORIZATION_ENDPOINT: config.authorizationEndpoint,
      VITE_OIDC_TOKEN_ENDPOINT: "http://localhost:9000/token",
      VITE_OIDC_JWKS_URI: config.jwksUri,
      VITE_OIDC_ALLOW_LOOPBACK_HTTP: "true",
    }),
  ).toBeNull();
});

it("preserves configured provider query parameters when constructing the PKCE authorization URL", async () => {
  const client: OidcTokenClient = {
    exchangeCode: vi.fn(),
    refresh: vi.fn(),
  };
  const session = new OidcSession(
    { ...config, authorizationEndpoint: "https://issuer.test/authorize?connection=corp" },
    client,
  );
  const url = new URL(await session.beginLogin());
  expect(url.searchParams.get("connection")).toBe("corp");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
});

it("preserves configured provider logout query parameters", () => {
  const client: OidcTokenClient = { exchangeCode: vi.fn(), refresh: vi.fn() };
  const session = new OidcSession(
    { ...config, endSessionEndpoint: "https://issuer.test/logout?connection=corp" },
    client,
  );
  const redirect = session.logout();
  expect(redirect).not.toBeNull();
  const url = new URL(redirect!);
  expect(url.searchParams.get("connection")).toBe("corp");
  expect(url.searchParams.get("post_logout_redirect_uri")).toBe(config.redirectUri);
});
