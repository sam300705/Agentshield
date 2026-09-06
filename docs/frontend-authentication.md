# Frontend Authentication

The dashboard has two explicit modes. When `VITE_APP_MODE` is anything other than `live`, the Vercel/static experience renders the labeled deterministic portfolio demo and does not configure an API token provider. When `VITE_APP_MODE=live`, the entrypoint requires the provider-neutral OIDC gate before rendering the authenticated API-backed console.

The live flow uses the authorization-code flow with PKCE. It generates a cryptographically random state, nonce, and code verifier in memory, sends an S256 code challenge to the authorization endpoint, validates callback state and issuer/nonce/audience claims, exchanges the code through an application-provided token client, injects bearer tokens only into API requests, and omits cookies. Access and refresh tokens are held in memory only; the frontend does not write them to `localStorage` or `sessionStorage`.

Expired access tokens use the in-memory refresh token when available. A failed refresh clears the session and exposes a sign-in state. Logout clears memory first and optionally redirects to the provider's end-session endpoint. API `401` responses expose a session-expired state, while `403` responses expose an authenticated-but-forbidden state. Missing OIDC configuration in live mode shows an explicit configuration error and never falls back to fixture data.

## Frontend variables

| Variable                           | Purpose                           | Required in live mode                                 |
| ---------------------------------- | --------------------------------- | ----------------------------------------------------- |
| `VITE_APP_MODE`                    | Selects `demo` or `live` behavior | Yes; use `live` only for an authenticated deployment. |
| `VITE_API_BASE_URL`                | API HTTPS origin                  | Yes for live API traffic.                             |
| `VITE_OIDC_ISSUER`                 | Expected issuer claim             | Yes.                                                  |
| `VITE_OIDC_CLIENT_ID`              | Public OIDC client identifier     | Yes.                                                  |
| `VITE_OIDC_REDIRECT_URI`           | Registered callback URI           | Yes.                                                  |
| `VITE_OIDC_AUTHORIZATION_ENDPOINT` | Authorization-code endpoint       | Yes.                                                  |
| `VITE_OIDC_TOKEN_ENDPOINT`         | Code and refresh-token endpoint   | Yes.                                                  |
| `VITE_OIDC_END_SESSION_ENDPOINT`   | Optional provider logout endpoint | Optional.                                             |
| `VITE_OIDC_AUDIENCE`               | Expected API audience             | Recommended when the provider issues audience claims. |
| `VITE_OIDC_SCOPES`                 | Space-separated scopes            | Defaults to `openid profile email`.                   |

Vite variables are public browser configuration. Never place client secrets, private keys, refresh tokens, or database credentials in `VITE_*` variables. The provider must register the exact HTTPS redirect URI and API audience used by the deployment.

## Current status

The session controller, PKCE construction, callback validation, refresh and logout behavior, explicit configuration failure, and authenticated live summary/scan-history view are **implemented and tested with local mocks**. No provider-specific login is live in the deployed Vercel preview, and no production OIDC provider has been configured. The live view intentionally does not expose fake repository, scan-creation, approval, or receipt controls until their backend capabilities are connected and verified.
