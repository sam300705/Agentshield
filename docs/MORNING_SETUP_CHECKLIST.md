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

## 5. Activate the GitHub App integration (owner configuration required)

**Why:** Real repository scanning requires a genuine GitHub App installation, tenant-to-installation mapping, short-lived installation tokens, and public webhook delivery.

**Where:** GitHub Developer Settings and the AgentShield deployment secret manager.

**Permission required:** GitHub App administrator access for registration and installation, plus deployment-operator access to inject secrets. Do not use a personal access token in the application.

**Action:** Register an App with the smallest approved read-only repository permissions, configure the webhook URL and secret, and supply `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_PRIVATE_KEY` through secret management. Install it only for an authorized test organization.

**Effort:** Approximately 20–40 minutes, depending on GitHub organization approval.

**Verify:** Confirm a real installation is mapped to the intended organization, repository discovery is read-only and tenant-scoped, installation tokens are short-lived and never logged, and a signed test webhook is accepted while an invalid or replayed delivery is rejected.

**Rollback:** Uninstall the App and revoke its credentials. Preserve scan evidence and audit history. Do not delete tenant data during rollback.

## 6. Activate OSV enrichment and signed receipts (owner configuration required)

**Why:** The tested OSV adapter and Ed25519 receipt primitives need explicit scan-lifecycle, persistence, and key-management decisions before they can affect customer workflows.

**Where:** AgentShield deployment configuration and the approved secret manager.

**Permission required:** Application owner approval for provider activation and signing-key custody. No OSV credential is required by the adapter; production signing requires a protected private key.

**Action:** Decide the outage policy for `OSV_API_ENABLED`, add advisory persistence and report/export integration, and configure `RECEIPT_SIGNING_KEY_ID`, `RECEIPT_SIGNING_PRIVATE_KEY`, and `RECEIPT_SIGNING_PUBLIC_KEYS_JSON` only after key generation, rotation, and backup procedures are approved.

**Effort:** Approximately 30–60 minutes for configuration decisions, plus engineering work for persistence and scan-lifecycle wiring.

**Verify:** Run deterministic advisory fixtures, verify a signed receipt using `pnpm receipt:verify`, confirm modified receipts fail verification, and confirm private key material is absent from logs, Git, and browser code.

**Rollback:** Disable enrichment and signed export, rotate or revoke the signing key if exposure is suspected, and keep the existing SHA-256 receipt records available for audit continuity.

## 7. Final review before calling the system production-ready

Do not merge pull request #2 or describe the service as production-ready until authentication, Neon, API ingress, scheduled worker execution, Vercel API-base wiring, backups, and an end-to-end authenticated scan have all been verified. The current honest readiness level remains **portfolio prototype / controlled internal alpha**, not a production certification.
