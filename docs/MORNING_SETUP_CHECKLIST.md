# AgentShield Morning Setup Checklist

This checklist contains only actions that require the account owner or a deployment operator. Never paste secret values into GitHub, chat, screenshots, issue comments, or committed files.

## 1. Create the free Neon PostgreSQL project

**Why:** The API and scan worker require shared PostgreSQL persistence.

**Where:** [Neon Console](https://console.neon.tech/).

**Action:** Use the existing Free project `broad-cake-58370276` and the `production` branch, or create one free project if that project is not intended for AgentShield. Keep the project on the Free plan, keep scale-to-zero enabled, and set a low autoscaling limit.

**Values needed:** Copy the pooled connection string for `DATABASE_URL` and the direct unpooled connection string for `DATABASE_URL_UNPOOLED`. Do not put either value in this file or in the repository.

**Least privilege:** Use a dedicated application database role rather than an owner role when Neon supports it. The migration operator may need schema-change permission; the runtime API and worker should use a role limited to the AgentShield database.

**Verify:** `pnpm db:deploy` completes against `DATABASE_URL_UNPOOLED`; `GET /health/ready` returns success after the API is deployed; a scan job completes in the database.

**Rollback:** Stop the API and worker, restore the provider-managed database backup or forward-apply a compatible migration, and redeploy the previous application commit. Do not use `pnpm db:push`.

## 2. Choose and configure production OIDC

**Why:** Production authentication intentionally fails closed without a verified identity provider.

**Where:** An OIDC provider such as Auth0, Clerk, Microsoft Entra ID, or another provider approved by the operator.

**Action:** Create an application/API configuration and configure signed JWT access tokens with a stable subject, AgentShield role claim, and organization claim. The current API expects `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `OIDC_ROLE_CLAIM`, and an organization claim such as `organization_id`, `organizationId`, or `org_id`.

**Values needed:** The issuer URL, API audience, JWKS URL, role-claim name, organization-claim name, and a test user assigned to one supported role. Do not commit client secrets or tokens.

**Least privilege:** Request only the scopes and claims needed to authenticate and authorize AgentShield users. Do not request users’ personal GitHub tokens.

**Verify:** A valid bearer token reaches a protected endpoint and is limited to its organization; a missing, expired, wrong-audience, wrong-issuer, or wrong-organization token returns 401/403 as appropriate. Demo authentication must remain disabled.

**Rollback:** Disable the provider application or remove its deployment secrets, then redeploy the previous known-good configuration. Do not re-enable demo authentication in production.

## 3. Deploy the API and worker with Azure Container Apps

**Why:** The Azure VM route is blocked by unavailable free VM SKUs; Container Apps avoids that VM restriction and does not require a card.

**Where:** Azure Portal or Azure Cloud Shell using the existing Azure for Students subscription.

**Action:** Follow [`deploy/azure-container-apps/README.md`](../deploy/azure-container-apps/README.md). Create a Container Apps environment in a region actually available to the subscription. Deploy the API with managed HTTPS ingress and create the scheduled worker job with `WORKER_MODE=once`.

**Values needed:** Resource group, Azure Container Apps environment, API app name, worker job name, Neon pooled/direct URLs, OIDC values, and exact Vercel origin. Inject secrets through Container Apps secret references only.

**Least privilege:** Use one resource group, no public ingress for the worker, one API replica maximum, 0.25 CPU/0.5 GiB worker resources, and no Marketplace add-ons. Do not upgrade Azure for Students to Pay-As-You-Go.

**Verify:** The generated HTTPS API origin responds to `/health/live` and `/health/ready`; the worker job starts, claims, and completes a queued scan; the API has no database credentials in logs.

**Rollback:** Stop or disable the API and worker, or redeploy the previous image revision. Delete the Container Apps resource group only after explicit operator approval and a retention decision. Do not delete the Neon database unless a backup and explicit data-retention decision exist.

## 4. Connect Vercel to the API

**Why:** The Vercel dashboard must call the deployed API instead of its local development fallback.

**Where:** Vercel project `agentshield` → Settings → Environment Variables.

**Action:** Set `VITE_API_BASE_URL` to the exact generated Azure Container Apps HTTPS API origin and redeploy the dashboard. Set the API `CORS_ORIGIN` to the exact Vercel dashboard origin.

**Values needed:** API origin and Vercel origin only; neither is a secret.

**Least privilege:** Configure the variable only for the intended Preview/Production environment and keep the API CORS allowlist exact rather than wildcarded.

**Verify:** Browser network calls target the Azure API origin; `/health/live` and `/health/ready` succeed; protected calls receive the expected authentication response; no browser console error exposes secrets.

**Rollback:** Restore the previous Vercel environment variable or redeploy the previous ready deployment. Keep the API running until traffic has drained.

## 5. GitHub App and repository onboarding (not yet implemented)

**Why:** Real repository scanning requires installation ownership, short-lived GitHub App tokens, and signed webhook handling.

**Where:** GitHub Developer Settings and the AgentShield deployment configuration.

**Action:** This remains a future P0/P1 implementation task. Do not create or install a GitHub App until the adapter, installation verification, webhook signature tests, and least-permission manifest are implemented.

**Values needed:** App ID, client ID, client secret, webhook secret, private key, callback URLs, and installation ID. Supply them only through a secret manager after implementation is verified.

**Least privilege:** Request repository metadata and read-only contents/pull-request access only until a reviewed write workflow is required. Never request a personal access token.

**Verify:** Installation ownership, signed webhook timestamp/replay checks, repository allowlisting, and short-lived installation token exchange all pass against fake fixtures before live installation.

**Rollback:** Uninstall the GitHub App and revoke its credentials. Preserve scan evidence and audit history.

## 6. Final review before calling the system production-ready

Do not merge pull request #2 or describe the service as production-ready until authentication, Neon, API ingress, scheduled worker execution, Vercel API-base wiring, backups, and an end-to-end authenticated scan have all been verified. The current honest readiness level remains **portfolio prototype / controlled internal alpha**, not a production certification.
