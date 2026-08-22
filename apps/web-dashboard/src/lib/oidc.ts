export interface OidcConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
  scopes: string[];
  audience?: string;
}

export interface OidcTokenSet {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
  idTokenClaims?: {
    issuer: string;
    audience: string | string[];
    nonce: string;
    subject: string;
    expiresAt: number;
  };
}

export interface OidcTokenClient {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<OidcTokenSet>;
  refresh(input: { refreshToken: string; clientId: string }): Promise<OidcTokenSet>;
}

interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

const TRANSACTION_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_SKEW_MS = 30_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomBase64Url(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return toBase64Url(new Uint8Array(digest));
}

function audienceMatches(audience: string | string[], expected: string): boolean {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function validateClaims(
  config: OidcConfig,
  transaction: LoginTransaction,
  tokens: OidcTokenSet,
): void {
  const claims = tokens.idTokenClaims;
  if (claims == null)
    throw new Error("OIDC token response did not include validated ID-token claims.");
  if (claims.issuer !== config.issuer || claims.nonce !== transaction.nonce) {
    throw new Error("OIDC issuer or nonce validation failed.");
  }
  if (config.audience != null && !audienceMatches(claims.audience, config.audience)) {
    throw new Error("OIDC audience validation failed.");
  }
  if (claims.subject.length === 0 || claims.expiresAt * 1000 <= Date.now()) {
    throw new Error("OIDC subject or expiration validation failed.");
  }
}

export class OidcSession {
  private tokens: OidcTokenSet | null = null;
  private transaction: LoginTransaction | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(
    private readonly config: OidcConfig,
    private readonly client: OidcTokenClient,
    private readonly now: () => number = Date.now,
  ) {}

  async beginLogin(): Promise<string> {
    const transaction: LoginTransaction = {
      state: randomBase64Url(32),
      nonce: randomBase64Url(32),
      codeVerifier: randomBase64Url(48),
      createdAt: this.now(),
    };
    this.transaction = transaction;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(" "),
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: await createCodeChallenge(transaction.codeVerifier),
      code_challenge_method: "S256",
    });
    if (this.config.audience != null) params.set("audience", this.config.audience);
    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  async handleCallback(callbackUrl: string): Promise<void> {
    const url = new URL(callbackUrl);
    const error = url.searchParams.get("error");
    if (error != null) throw new Error(`OIDC authorization failed: ${error}.`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const transaction = this.transaction;
    this.transaction = null;
    if (code == null || state == null || transaction == null) {
      throw new Error("OIDC callback is missing a pending authorization transaction.");
    }
    if (this.now() - transaction.createdAt > TRANSACTION_TTL_MS || state !== transaction.state) {
      throw new Error("OIDC state validation failed or the transaction expired.");
    }
    const tokens = await this.client.exchangeCode({
      code,
      codeVerifier: transaction.codeVerifier,
      redirectUri: this.config.redirectUri,
      clientId: this.config.clientId,
    });
    validateClaims(this.config, transaction, tokens);
    this.tokens = tokens;
  }

  async getAccessToken(): Promise<string | null> {
    if (this.tokens == null) return null;
    if (this.tokens.expiresAt > this.now() + ACCESS_TOKEN_SKEW_MS) return this.tokens.accessToken;
    if (this.tokens.refreshToken == null) {
      this.clear();
      return null;
    }
    if (this.refreshInFlight == null) {
      this.refreshInFlight = this.refreshAccessToken().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  logout(): string | null {
    const idToken = this.tokens?.idToken;
    this.clear();
    if (this.config.endSessionEndpoint == null) return null;
    const params = new URLSearchParams({ post_logout_redirect_uri: this.config.redirectUri });
    if (idToken != null) params.set("id_token_hint", idToken);
    return `${this.config.endSessionEndpoint}?${params.toString()}`;
  }

  clear(): void {
    this.tokens = null;
    this.transaction = null;
    this.refreshInFlight = null;
  }

  isAuthenticated(): boolean {
    return this.tokens != null;
  }

  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = this.tokens?.refreshToken;
    if (refreshToken == null) {
      this.clear();
      return null;
    }
    try {
      const tokens = await this.client.refresh({ refreshToken, clientId: this.config.clientId });
      const transaction = this.transaction ?? {
        state: "refresh",
        nonce: tokens.idTokenClaims?.nonce ?? "refresh",
        codeVerifier: "refresh",
        createdAt: this.now(),
      };
      validateClaims(this.config, transaction, tokens);
      this.tokens = tokens;
      return tokens.accessToken;
    } catch {
      this.clear();
      return null;
    }
  }
}

export function readOidcConfig(env: Record<string, string | undefined>): OidcConfig | null {
  if (env.VITE_APP_MODE !== "live") return null;
  const required = {
    issuer: env.VITE_OIDC_ISSUER,
    clientId: env.VITE_OIDC_CLIENT_ID,
    redirectUri: env.VITE_OIDC_REDIRECT_URI,
    authorizationEndpoint: env.VITE_OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: env.VITE_OIDC_TOKEN_ENDPOINT,
  };
  if (Object.values(required).some((value) => value == null || value.trim().length === 0))
    return null;
  return {
    ...required,
    endSessionEndpoint: env.VITE_OIDC_END_SESSION_ENDPOINT,
    scopes: (env.VITE_OIDC_SCOPES ?? "openid profile email").split(/\s+/).filter(Boolean),
    audience: env.VITE_OIDC_AUDIENCE,
  } as OidcConfig;
}

export function createFetchTokenClient(config: OidcConfig): OidcTokenClient {
  async function parseResponse(response: Response): Promise<OidcTokenSet> {
    if (!response.ok) throw new Error(`OIDC token endpoint returned HTTP ${response.status}.`);
    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof body.access_token === "string" ? body.access_token : null;
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
    if (accessToken == null || expiresIn <= 0) throw new Error("OIDC token response is invalid.");
    const idTokenClaims = body.id_token_claims;
    const tokenSet: OidcTokenSet = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    if (typeof body.refresh_token === "string") tokenSet.refreshToken = body.refresh_token;
    if (typeof body.id_token === "string") tokenSet.idToken = body.id_token;
    if (typeof idTokenClaims === "object" && idTokenClaims != null) {
      tokenSet.idTokenClaims = idTokenClaims as NonNullable<OidcTokenSet["idTokenClaims"]>;
    }
    return tokenSet;
  }
  return {
    exchangeCode(input) {
      return fetch(config.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          client_id: input.clientId,
        }),
        credentials: "omit",
      }).then(parseResponse);
    },
    refresh(input) {
      return fetch(config.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          client_id: input.clientId,
        }),
        credentials: "omit",
      }).then(parseResponse);
    },
  };
}
