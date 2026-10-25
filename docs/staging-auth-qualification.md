# Controlled staging authentication qualification

This is Phase 3 staging preparation, not Phase 3 acceptance or authorization to
advance dependent phases. Credentials stay in approved provider secret stores.
The GitHub App PEM already stored in Render must not be copied into chat or source.

## Current evidence, 2026-10-25

- The attached Codex runtime moved from pending/offline to running/connected and
  executed commands. Publication of the simplified configuration draft remains
  unverified. Runtime source configuration revision 2 still reports a Render secret
  binding with unknown readiness; this does not describe the latest saved draft.
- Retained network diagnostic history is empty. No environment publication repair
  or configuration tool is available in this session. The runtime skill is available;
  an onboarding skill was not found in the available catalogs or local skill files.
- The Phase 3 checkout was clean at `bf40ef1f2f2f59342a12412c45e54493518cb29a`.
  PR #18 was open with base `phase3/github-e2e`; both exact-head quality jobs reported
  completed/success. The no-findings code-review receipt covers that historical head.
- Auth0 discovery returned 200 with issuer
  `https://dev-bhnwe1dx8llwlaeh.us.auth0.com/` and advertised authorization, token,
  JWKS and OIDC logout endpoints. Discovery is not a login or management-access test.
- Render service and deploy-list reads returned 401 using the configured binding.
  Its presence does not establish usable authorization. The response does not
  distinguish invalid credentials from injection/setup failure. No secret value was
  printed and no unchanged request was retried.
- Staging health and protected-repository requests timed out after 25 seconds.
  Current health, authentication rejection and deployed source are unverified;
  the earlier 200/401 observations must not be promoted to current evidence.

## Bounded package P3-A1

Add an optional exact tenant-claim selector alongside the existing role selector.
This supports namespaced provider claims without selecting a conflicting legacy
alias. No schema migration, dependency, tenant creation, live configuration change
or new endpoint is required. Leaving the selector unset preserves compatibility.
The real HTTP/JWKS tests use synthetic signed JWTs, not Auth0 credentials. They
reproduce wrong-tenant selection and legacy fallback before the change, then check
configured selection, missing/malformed claims, issuer and role rejection, and
legacy compatibility. Live provider acceptance remains separate.

Local verification: 459 workspace unit cases pass (228 API), including the two
new HTTP/JWKS regressions that failed before the change. Lint, typecheck, build,
format and documentation checks pass. Local execution used Node 24.19.0 and the
repository-pinned pnpm 9.15.4 via a workspace-local Corepack shim; the shell's
default pnpm 11.25.0 could not run repository scripts. CI uses Node 22 and must
qualify the published candidate separately. No local PostgreSQL, browser or
live-provider lifecycle acceptance is claimed by this package.

## Provider configuration to complete

1. Restore authorized Render management access through the environment's secure
   configuration workflow. Inspect the existing staging service and deployed commit
   before any change. Do not regenerate or request the existing GitHub App PEM.
   Verify the saved environment draft and publication separately from task startup;
   do not repeatedly retry publication without a changed condition or diagnostics.
2. Identify the existing Auth0 SPA's public client ID and the exact intended preview
   origin/callback. Register only those callback, logout and allowed web origins.
   Use authorization code with PKCE; keep client secrets out of the browser. A
   discovery response supplies no evidence that this application exists or is ready.
3. Select one existing or explicitly provisioned internal `Organization.id` for
   qualification. An Auth0 organization identifier is not automatically an internal
   organization mapping. Review the mapping and authorized users before granting
   claims. Do not run the demo seed against staging or reset retained tenant data.
4. In the trusted issuer, emit access-token claims for the API audience
   `https://agentshield-staging-api.onrender.com`. Suggested exact claim names are
   `https://agentshield-staging-api.onrender.com/organization_id` and
   `https://agentshield-staging-api.onrender.com/roles`. Configure the API's
   `OIDC_TENANT_CLAIM` and `OIDC_ROLE_CLAIM` to those names only after the new source
   is deployed. Use administrator-controlled data or a reviewed organization mapping;
   never infer authority from email domains or editable user metadata. Recognized
   roles are `VIEWER`, `DEVELOPER`, `SECURITY_REVIEWER`, `POLICY_ADMINISTRATOR` and
   `ORGANIZATION_ADMINISTRATOR`. Grant the minimum required role with no default
   administrator fallback. Membership rows alone do not enforce API authorization;
   the current API trusts issuer-provided tenant and role claims.
5. Verify backend issuer (including trailing slash), API audience, advertised JWKS
   URL, exact CORS origin, OIDC mode and disabled demo auth. Do not activate webhook
   ingestion yet. Configure a preview only after identifying its actual deployed
   source and public client ID: `VITE_APP_MODE=live`, staging API base, issuer,
   authorization/token/JWKS URLs, registered redirect URI and API audience. Include
   `VITE_OIDC_JWKS_URI`, which is required by the current frontend implementation.
6. Complete an interactive login without sharing tokens in chat. Verify a protected
   API request with the intended tenant and role, an allowed role operation, a
   forbidden role operation, and isolation from another controlled tenant. Verify
   missing namespaced claims cannot fall back to legacy aliases. Record safe IDs,
   statuses, source SHA and timestamps only. Do not call an unauthenticated 401 a
   successful authenticated tenant qualification.
7. Then verify tenant-bound installation registration for installation `174121239`
   and only repository `sam300705/agentshield-staging-qualification` (ID
   `1429734213`). Inspect current mappings before writing. Webhook secret storage
   does not establish hook binding. Worker provisioning still needs cost approval
   before paid resources. Keep webhook ingestion disabled until the approved ingress,
   binding, tenant/policy and worker prerequisites are verified together.

Final Phase 3 evidence must trace a live delivery to its exact commit, scan, policy
decision, complete receipt and GitHub Check, including controlled blocking/replay
cases and read-only `github:operator verify-live` observation. Implemented code,
synthetic tests, CI, provider evidence and owner acceptance remain separate gates.
