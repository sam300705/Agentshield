# Phase 4 production operations

Base: `49d2274c601a63b88aadcaa511526af1bb90946a` (Phase 3, unmerged).
Branch: `phase4/production-readiness`. This is an operating model and implementation;
external infrastructure and a live GitHub installation still require owner configuration.
No production deployment, backup, restore, or real GitHub Check is claimed by CI fixtures.

## Audit and selected topology

| Area at Phase 3                             | Classification                       | Phase 4 response                                                                                                                                           |
| ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent API and durable Postgres worker | IMPLEMENTED UNVERIFIED in production | Preserve tenant constraints, attempt fences, leases, retries and persisted Checks                                                                          |
| Vercel dashboard, live OIDC PKCE gate       | EXTERNAL CONFIG REQUIRED             | Preserve real login, validate live build config, add static security/cache headers                                                                         |
| Render blueprint                            | PARTIAL                              | Remove obsolete branch; manual main releases, generate Prisma before build, API-only predeploy migration                                                   |
| Azure VM / Container Apps alternatives      | IMPLEMENTED UNVERIFIED               | Keep alternatives; remove per-API startup migration; use the same hardened image                                                                           |
| API rate protection                         | DEVELOPMENT ONLY                     | Shared Redis REST atomic Lua, ingress plus verified tenant/actor budgets; fail closed                                                                      |
| API / worker shutdown                       | PARTIAL                              | Drain requests and current scan; 110-second bound; forced exit uses existing lease recovery                                                                |
| Container                                   | PARTIAL                              | Pinned Node image digest, pruned API deployment, nonroot, no credentials/fixtures/dev server                                                               |
| Receipt key validation / custody            | PARTIAL                              | Ed25519 startup validation and signer interface; platform-secret custody accurately identified                                                             |
| Logs / metrics / traces                     | PARTIAL                              | Safe JSON HTTP and job correlation, bounded labels, W3C trace IDs, optional redacted error collector                                                       |
| API readiness / worker health               | PARTIAL                              | DB readiness deadline; private worker heartbeat file/probe                                                                                                 |
| Managed backups / live release              | EXTERNAL CONFIG REQUIRED             | Owner provisioning, backup/restore/release procedures below                                                                                                |
| CI actual production image                  | MISSING                              | Fresh TLS Postgres, shared real Redis, two APIs, parallel representative fixture scans with verified signed receipts, independent worker and graceful stop |
| Demo UI / fixture source                    | DEMO ONLY                            | Separate demo mode; never activate in the production environment                                                                                           |

Canonical deployment: existing **Vercel dashboard + Render API and background worker +
Neon Postgres + Upstash Redis REST**. This preserves the existing Blueprint and needs
no Kubernetes, broker, or replacement queue. Redis is exclusively request protection;
Postgres remains authoritative for jobs, tenant ownership, audit, findings and Check delivery.
Render's API/worker plans require paid compute; confirm budget before provisioning.
The existing Azure student-credit instructions are an alternative when that budget is
unavailable, not an additional production environment. Neither path is provisioned here.
Use one production environment and disposable previews; a separate staging environment
is optional. Never point previews or fork CI at production secrets or production Postgres.

## Service contracts

API: built `node apps/api/dist/index.js` in the image, or `node dist/index.js` in the
API package. Platform `PORT` wins (local default 3001). No Vite, migration or seeding
on startup. Exact CORS origin, Helmet headers and bearer authentication; no ambient
session cookies, so there is no cookie-based CSRF mechanism. Permit only the selected
HTTPS frontend origin. Set proxy hops to the exact trusted platform topology (default
zero, maximum two); the ingress must overwrite forwarded headers and block direct
untrusted paths. Never set blanket `trust proxy=true`.

Worker: built `node apps/api/dist/worker.js`, independent service, no public HTTP/admin
endpoint. One-second idle poll; lease heartbeats and bounded scan retries remain in
Postgres. SIGTERM stops new claims and keeps the current job heartbeat active while
it finishes. After 110 seconds a forced exit leaves the attempt fence/lease for stale
recovery rather than pretending the user cancelled the scan. Run a supervisor that
restarts nonzero exits with bounded backoff (1–30 seconds); DB failure stops the process
and never creates an in-memory queue. `WORKER_MODE=once` is for scheduled jobs, not
an always-on Render worker. During a scan, health refreshes every ten seconds with a
DB check; `node apps/api/dist/workerProbe.js` succeeds only for a recent running marker.
Use one worker per container and a writable private `/tmp`; do not share heartbeat files.

Production startup checks DB and a bounded shared-Redis operation before listening. Configuration validates OIDC/GitHub/signing requirements first. `GET /health/live` is lightweight; `GET /health/ready` checks DB with a three-second
response deadline. Probes bypass OIDC and Redis so Redis outages do not cause a
restart storm. Readiness is not a claim that GitHub/OIDC/Redis is online; alert separately
on protection errors and queue age. Prisma connection/pool timeouts must also be bounded:
a response deadline does not cancel an underlying database query.

The Redis limiter establishes counter and TTL atomically using EVAL and repairs a
missing TTL. HTTPS requests have a two-second deadline, no redirects, and no retry
of an increment whose outcome is uncertain. All application routes fail closed with
503 during Redis failures, including signed webhooks (redelivery can retry later).
Ingress uses hashed IP; authenticated budgets use hashed organization/actor and a
fixed read/mutation category. No raw paths, tokens or unbounded route labels. Redis
keys expire; local in-memory protection is bounded and development-only. Worker
operations never require Redis. Budget shared GitHub provider IP traffic deliberately.

## Configuration matrix

P = production, D = development/test. Platform secret fields are never `VITE_*`.

| Variable                                                                                         | Mode / required / default                                                          | Secret    | Consumer                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| NODE_ENV                                                                                         | P: production; D: development                                                      | no        | API, worker                                     |
| PORT / API_PORT                                                                                  | platform PORT; local 3001 (API_PORT legacy)                                        | no        | API                                             |
| DATABASE_URL                                                                                     | required; PostgreSQL TLS sslmode=require or verify-full in P                       | yes       | API, worker                                     |
| DATABASE_URL_UNPOOLED                                                                            | required for explicit migrate deploy/generate; direct TLS URL                      | yes       | release job                                     |
| CORS_ORIGIN                                                                                      | P required exact HTTPS origin; D http://localhost:5173                             | no        | API/config validation                           |
| AUTH_MODE                                                                                        | oidc; demo forbidden in P                                                          | no        | API, worker validation                          |
| DEMO_AUTH_ENABLED                                                                                | false/unset in P; explicit true only D                                             | no        | API                                             |
| OIDC_ISSUER / OIDC_AUDIENCE / OIDC_JWKS_URL                                                      | P required exact issuer/audience, HTTPS JWKS                                       | no        | API/config validation                           |
| OIDC_ROLE_CLAIM                                                                                  | roles                                                                              | no        | API                                             |
| TRUST_PROXY_HOPS                                                                                 | 0; integer 0–2 matching trusted ingress                                            | no        | API                                             |
| RATE_LIMIT_ENABLED                                                                               | true in P, cannot disable; false default D                                         | no        | API                                             |
| RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS                                                            | 120 / 60000; bounded validated integers                                            | no        | API                                             |
| REDIS_REST_URL / REDIS_REST_TOKEN                                                                | P required HTTPS endpoint / write-capable REST token                               | token yes | API; worker validates shared deployment config  |
| GITHUB_WEBHOOK_ENABLED                                                                           | false unless explicitly enabled                                                    | no        | API                                             |
| GITHUB_WEBHOOK_SECRET                                                                            | required with webhook ingestion                                                    | yes       | API                                             |
| GITHUB_SCAN_LIFECYCLE_ENABLED / GITHUB_MATERIALIZATION_ENABLED                                   | paired flags; false default                                                        | no        | API, worker                                     |
| GITHUB_APP_ID / GITHUB_PRIVATE_KEY                                                               | numeric App ID / RSA private key required with materialization                     | key yes   | worker, operator; API validates coherent config |
| GITHUB_SCAN_POLICY_BUNDLE_VERSION                                                                | required with scan lifecycle                                                       | no        | API                                             |
| GITHUB_CLIENT_ID                                                                                 | optional existing App metadata; not a login secret                                 | no        | existing integration configuration              |
| RECEIPT_SIGNING_REQUIRED                                                                         | true default P; optional false explicitly allows unsigned receipts                 | no        | worker/API scan execution                       |
| RECEIPT_SIGNING_KEY_ID / RECEIPT_SIGNING_PRIVATE_KEY                                             | required when signing required; Ed25519 key                                        | key yes   | worker/scan signer                              |
| WORKER_MODE                                                                                      | unset long-running; once for batch jobs                                            | no        | worker                                          |
| WORKER_PAUSED / GITHUB_CHECKS_PAUSED                                                             | unset; true pauses claims / provider publication until restart                     | no        | worker                                          |
| WORKER_HEALTH_FILE                                                                               | /tmp/agentshield-worker-health.json; private writable file                         | no        | worker/probe                                    |
| METRICS_TOKEN                                                                                    | optional minimum 32-character platform scraper token; absent disables /ops/metrics | yes       | API                                             |
| ERROR_REPORT_URL / ERROR_REPORT_TOKEN                                                            | optional HTTPS collector / bearer                                                  | token yes | API, worker                                     |
| VITE_APP_MODE                                                                                    | live for production; demo is explicitly a demonstration                            | no        | dashboard build                                 |
| VITE_API_BASE_URL                                                                                | live requires HTTPS API origin                                                     | no        | dashboard build                                 |
| VITE_OIDC_ISSUER / CLIENT_ID / REDIRECT_URI / AUTHORIZATION_ENDPOINT / TOKEN_ENDPOINT / JWKS_URI | live requires all (each name has VITE*OIDC* prefix)                                | no        | dashboard build                                 |
| VITE_OIDC_SCOPES / AUDIENCE / END_SESSION_ENDPOINT                                               | optional; openid profile email / API audience / logout endpoint                    | no        | dashboard build                                 |
| WEB_PORT                                                                                         | local 5173 only                                                                    | no        | local Vite                                      |

Use Neon's pooled TLS runtime URL with explicit `connection_limit=3`, `pool_timeout=5`
and `connect_timeout=5` as a starting point, adjusted to the actual provider connection
budget and API/worker replicas. Sum replica pools and retain reserve for migrations
and recovery. Use the **direct** URL for the single release migration step. No hardcoded
localhost defaults in production. Do not disable certificate checks or use unverified
TLS in real deployment. CI's disposable Postgres uses its own test certificate.

OIDC access tokens require exp/iat/sub, issuer, audience, signature and recognized
role/organization claims. JWKS network deadline is three seconds, cache lifetime ten
minutes, rotation cooldown thirty seconds; no indefinite stale-key acceptance. Browser
OIDC already uses code+PKCE/state/nonce and memory-only tokens. Token endpoints are
bounded to ten seconds and reject redirects. Configure a public SPA client without a
client secret; exact callback/logout origins and API audience/tenant-role mapping.
An optional OIDC confidential secret belongs in the identity platform, never this SPA.

## Secrets and receipt custody

Enter backend secrets in the selected platform's secret/environment settings, not
Git, issue bodies, chat, Docker build arguments, screenshots or frontend variables.
Separate API and worker permissions where the platform permits (App private key and
receipt signing key primarily belong to the worker). Worker config currently validates
the coherent shared runtime environment; do not claim it has a separate secret broker.
Prefer platform secret references over plaintext VM env files; tightly restrict operator
access and audit reads. `.dockerignore` excludes all env files, keys, fixtures and Git.

The implemented signer is **platform-secret Ed25519**, not KMS/HSM. `ReceiptSigner`
separates receipt construction/persistence from key custody and keeps the existing
format/key ID/verification behavior. An external KMS adapter must support Ed25519,
return only a signature and verify it against the configured public key before use;
it is intentionally not represented as an implemented managed signer. Do not assume
Azure Key Vault's RSA/ECDSA keys are compatible with an Ed25519 receipt format.
Signing errors roll back the completion transaction; the durable worker retry/dead-letter
model reports failure and never marks an unsigned object verified. Explicit unsigned
mode remains accurately unsigned. Never generate replacement keys on service startup.

Rotation: create the new key through an operator-owned process; store it in platform
secrets, assign a new stable key ID, retain the old **public** key in the verification
key ring, test a new signed receipt, deploy workers, verify both old/new receipts, then
remove the old private key after draining old workers. Do not overwrite historical
receipt key IDs. Rotate DB credentials by adding a new least-privileged user, switching
services, verifying health and revoking the old user. Rotate Redis tokens by swapping
API secret and verifying both replicas. Rotate App private keys with overlap before
revoking old keys; rotate webhook HMAC during a paused-ingestion window and redeliver
failed deliveries. OIDC key rotation is provider-owned; test new/old overlapping JWKS
keys, then retire old keys after token expiry. Rotate collector credentials separately.

## Telemetry and alerts

JSON logs include safe service/event/status/duration and correlation/trace IDs. Job
claims add job/scan/worker/attempt correlation; GitHub audit records retain safe delivery,
installation, scan and Check IDs. Bodies, tokens, private keys, source/snippets, cookies,
query strings and provider error bodies are never telemetry fields. HTTP metric labels
are fixed method/status class; tenant job gauges require that tenant's administrator.
`/metrics` is tenant-authenticated; it does not expose global tenant queue counts. `/ops/metrics` exposes only process HTTP/webhook counters behind a separate optional platform METRICS_TOKEN (minimum 32 characters); absent configuration returns 404. HTTP
counters are process-local and need platform scraping across API replicas.

Trace IDs accept a bounded W3C traceparent and can join logs with an OpenTelemetry
collector integration; this is log correlation, not a claim of complete distributed spans.
The optional `ERROR_REPORT_URL` accepts a JSON envelope with service, stable code,
validated correlation/trace IDs only. Delivery has a two-second deadline, four in-flight
requests maximum, no retries or redirects, and failures never change scan decisions.
Use a trusted collector adapter for your provider; do not attach raw exceptions.

Alert on readiness failure, sustained HTTP 5xx/503 RATE_LIMIT_UNAVAILABLE, queue age
and nonzero failed/dead-letter counts, stale worker markers, repeated SCAN_FAILED/
RETRIES_EXHAUSTED audit events, rejected/repeated webhook deliveries, and publication
STOPPED/retries from GitHubCheckPublication. Use database read-only queries scoped
appropriately for queue age/lease recovery, scan durations and finding counts. Tenant metrics export queue age, retry/stale/dead-letter gauges, recovery/publication failure counts over 24 hours, finding category counts, and duration samples from the latest 100 completed scans in 24 hours. These are explicitly sampled gauges, not complete all-time histograms. Verify scraping and collector configuration before claiming an operational telemetry deployment.

## Backup, restore, release and rollback

Owner must choose and verify a Neon backup/PITR policy supported by their plan.
Target: daily backups, 7–14 days retention, provider PITR when available, and a manual
verified backup/restore point before migration. Record actual RPO/RTO and plan limits;
these values are recommendations, not a statement that backups exist. Encrypt exports
and restrict access to audit/evidence. Run a restore drill to a separate project/branch
at least monthly and record the result. Never restore over the production database
without explicit owner approval.

Restore procedure: identify incident/cutoff and last usable backup; stop writes,
ingestion and workers; preserve audit logs; restore into an isolated target; verify
migration history, tenant ownership constraints, scan/job status consistency and
representative receipt verification; check API readiness and worker health against that
target; reconcile GitHub publications (a restored DB may predate external side effects);
get approval to switch services, resume a single worker then ingestion, monitor failures.
Keep the original database read-only for investigation; never delete it as a cleanup step.

Release only the reviewed main commit/tag after all stacked PRs merge in order and
required checks pass. Render auto-deploy is off. Protect main against direct writes;
configure production release approval and record the exact SHA/image digest. No
pull_request_target workflow executes PR code with secrets. PR CI has disposable
credentials only. Platform deployment credentials and production environments are
external setup, not repository-provided values.

Order: verify backup/restore point → stop or drain worker → one `pnpm db:deploy`
(API Render preDeployCommand, direct URL) → API readiness → worker → dashboard →
smoke authenticated tenant read/mutation and one real GitHub PR scan. Migration failure
blocks release. Never run db:push, migrate reset or demo seed in production. Container
release runs the `migrations` image target once; API/worker use `runtime` target. Do
not run a migration on every API replica. Existing SQL migrations remain unchanged;
Phase 4 needs no schema migration.

Rollback API/worker to the previous immutable compatible image and Vercel deployment;
keep migrated DB only if the old code remains compatible. Drain workers first. Prefer
forward repair for schema failures; do not blindly reverse SQL or overwrite audit data.
For a future incompatible migration, stage additive fields and backfill before removing
old fields in a later reviewed release. Document a tested rollback boundary before deploy.

## Failure / incident runbooks

| Symptom                              | Action and recovery                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API down / readiness 503             | Inspect safe logs and DB connectivity/limits; route away unhealthy API; restore DB/network; readiness must pass before traffic                                                   |
| Worker stalled / unhealthy           | Inspect marker and durable lease/job state; stop unhealthy instance; restart one worker; lease recovery fences old attempts                                                      |
| Queue growing                        | Check worker health, failed/dead-letter states, queue age and provider rate limits; add a small tested worker replica only within DB budget                                      |
| DB outage                            | Ingestion must not acknowledge nonexistent commits; worker stops; recover DB then resume persisted work, no local queue substitute                                               |
| Redis outage                         | Application requests return 503; repair token/endpoint/provider; never disable protection; health probes remain useful                                                           |
| OIDC/JWKS outage                     | Reject unverifiable/new expired tokens; repair issuer/JWKS/CORS/claims; existing valid cached keys only within bounded cache behavior                                            |
| Signing failure                      | Check platform key/key ID/type; preserve failed job/audit state; restore correct signer and retry under existing policy; never label unsigned verified                           |
| GitHub outage / revoked installation | Preserve findings/receipt; publication retries remain independent of scans; validate App installation/access, redeliver or retry-check only after repair                         |
| Migration failure                    | Stop release, inspect migration status with direct URL, preserve backup; reviewed forward fix or restore approval before any destructive action                                  |
| Scanner failure                      | Inspect stable failure code and attempt/timeout; bounded retries, then dead-letter; never silently treat failure as ALLOW                                                        |
| Suspected tenant incident            | Pause GitHub ingestion flag and WORKER_PAUSED / GITHUB_CHECKS_PAUSED, restart safely, preserve audit/evidence, rotate affected credentials, repair and verify before re-enabling |

Kill switches are operator environment settings and require controlled redeploy/restart;
they are not public admin endpoints. Pausing all claims does not erase jobs. For a single
tenant revoke that installation/access using existing operator-controlled binding and
stop only affected work where existing cancellation permits; preserve immutable audit.

Retention recommendation: scans/findings/receipts 90 days minimum, security audit one
year subject to owner obligations, sanitized operational logs 14–30 days, errors 30 days,
temporary source workspaces only during the scan and deleted on all paths. Crash-left
workspaces on ephemeral containers disappear on replacement; audit old persistent temp
volumes before removal. No automated irreversible retention deletion is added here.

## Owner configuration and evidence

1. Merge Phase 1 → 2 → 3 → 4 in order after review. Provision one selected backend
   topology. Set production branch main and manual deployments; configure release
   approval/protection in GitHub/platform settings. Confirm compute budget before creation.
2. In Neon Connect, obtain pooled and direct TLS URLs. Put them in backend secret
   settings as DATABASE_URL and DATABASE_URL_UNPOOLED; configure backup/PITR and
   restore retention in Neon, record a successful isolated restore drill.
3. In Upstash Redis, copy the HTTPS REST endpoint and token to backend REDIS*REST*\*
   secret fields. Verify two API replicas share a budget and an outage returns 503.
4. In identity-provider settings register the public SPA, exact redirect/logout origins,
   API audience and recognized organization/role claims. Enter backend OIDC*\* fields
   and public VITE_OIDC*\* fields in Vercel; never enter client/private keys in Vercel
   frontend variables. Set VITE_APP_MODE=live and VITE_API_BASE_URL to the HTTPS API. Before public production traffic, narrow the dashboard CSP connect-src in apps/web-dashboard/vercel.json from the HTTPS bootstrap allowance to the exact API, OIDC token and JWKS origins. The default protects script/frame/object sources but cannot know owner-specific network origins.
5. Generate/manage an Ed25519 receipt key outside Git/chat; save private key in backend
   secrets, key ID and public verification key in the operator key ring. Keep signing
   required. Verify a newly signed receipt and an old receipt before/after rotation.
6. Configure GitHub App permissions/webhook ingress and prebound installation using
   [github-app.md](github-app.md). Put App RSA and HMAC keys in backend secrets;
   enable paired lifecycle flags and policy version. Use `github:operator verify-live`
   after a real delivery. Evidence must include actual delivery/scan/head SHA/Check ID
   and conclusion, without credentials or repository source.
7. Follow the release order and run readiness/authenticated scan/worker/Check smoke.
   Configure log/error export and the alerts above. Record image SHA/digest, migration
   status, backup ID, health checks, receipt verification and real GitHub evidence.

Real deployment and real GitHub lifecycle: **BLOCKED BY OWNER / EXTERNAL CONFIG**
until these platform resources, identity/App settings and credentials exist. Do not
paste secrets into chat. CI production containers and the real-Postgres GitHub simulator
prove implementation behavior only, not a public deployment or real provider Check.

## Dependency and image review

The Phase 4 production audit initially reported eight advisories (one critical, one high,
five moderate, one low). Targeted HTTP transitive overrides patch body-parser, qs,
proxy-addr and deepmerge-ts. React Router is updated to the patched 7.18.2 release while
preserving the existing BrowserRouter API and UI. Run `pnpm audit --prod` after frozen
installation; CI also scans the actual runtime image for fixable HIGH/CRITICAL issues.
Trivy uses the verified v0.36.0 action commit and an explicit scanner version, not a
mutable old action tag. The complete all-severity report is uploaded as a 14-day CI artifact; unfixed issues remain visible for review rather than being represented as patched. Release only after reviewing the current image report.

## Verified implementation checkpoint

At `8ccff666bfff67d6a711b6261a57e697eceb9ec0`, both push and PR CI passed:
141 unit tests, 15 existing backend security groups, seven GitHub end-to-end groups,
six browser tests, production dashboard build, source/fixture SARIF gates, and the actual
container image smoke/security gate. The container check verified fresh TLS migrations,
a shared Redis budget across API replicas, two parallel real fixture scans with persisted
findings and cryptographically verified receipts, independent worker health and graceful
shutdown. Subsequent shutdown-claim hardening adds a backend regression group and must
pass the same required checks at the final PR head. These are CI results, not live
provider evidence. Backup/restore and real GitHub deployment remain external setup.
