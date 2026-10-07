# GitHub App integration — Phase 3

AgentShield implements signed webhook → persisted tenant/installation/repository identity →
commit-pinned durable scan → isolated workspace → deterministic scanner/policy/evidence →
GitHub Check. A live provider connection remains **BLOCKED BY OWNER/EXTERNAL CONFIG** until
an owner supplies a controlled test installation and a reachable webhook endpoint. Synthetic
CI verification does not establish a live GitHub installation. This is a controlled internal
alpha and is not described as production-ready.

## Baseline audit

The Phase 3 branch starts at `phase2/backend-core-security@f22615be02296912d30d66536b7b3cd0468c714b`.
PRs #9 and #10 were inspected and remained open/unmerged. Phase 3 targets Phase 2.

| Existing area                    | Baseline classification                              | Phase 3 disposition                                                           |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| HMAC/raw body                    | VERIFIED by unit tests; synthetic provider only      | Exact digest bytes, bounded headers and 25 MiB raw body; real HTTP test       |
| Installation JWT/API adapter     | PARTIAL                                              | PKCS1/PKCS8 RSA, safe failures, timeouts, headers, retry classification       |
| Tenant installation registration | IMPLEMENTED BUT UNVERIFIED live; UNSAFE reassignment | Operator-only provider-verified binding, no tenant reassignment               |
| Repository synchronization       | PARTIAL                                              | Numeric identity, explicit access flag, selected removal retained             |
| Installation lifecycle           | MISSING                                              | Created/deleted/suspend/unsuspend and selection events                        |
| Delivery store                   | PARTIAL / SYNTHETIC TEST ONLY                        | Transactional acceptance and enqueue, durable scoped uniqueness, safe lineage |
| PR/push routing                  | PARTIAL                                              | Relevant PR actions; branch pushes; SHA pinning; tags/deletions ignored       |
| Materializer                     | IMPLEMENTED BUT UNVERIFIED in worker                 | Production worker wired, remote numeric identity check, bounded extraction    |
| Workspace cleanup                | VERIFIED using synthetic archives                    | Existing unique temporary workspace provider retained                         |
| Check builders/API methods       | MOCKED / SYNTHETIC TEST ONLY                         | Durable independent publisher, external-ID reconciliation and retries         |
| Worker integration               | MISSING                                              | Existing lease-fenced executor and queue reused                               |
| Normal CI provider flow          | SYNTHETIC TEST ONLY (enqueue only)                   | HTTP provider simulator + real PostgreSQL/worker/scanner/policy               |
| Real installation/webhook/Check  | MISSING external configuration                       | Owner gate; never reported as synthetic PASS                                  |

## App permissions and events

Register an App called **AgentShield Security** (choose an owner-specific unique slug).
Use the project's existing HTTPS homepage. Enable webhooks to the approved API's HTTPS URL
ending `/api/v1/integrations/github/webhooks`. No OAuth callback is required for this flow.

| Repository permission | Access | Purpose                    |
| --------------------- | ------ | -------------------------- |
| Metadata              | Read   | Repository identity        |
| Contents              | Read   | Immutable commit archive   |
| Pull requests         | Read   | Pull-request event context |
| Checks                | Write  | Security Check lifecycle   |

Subscribe only to `installation`, `installation_repositories`, `pull_request`, and `push`.
Installation events are supplied by GitHub where appropriate. Do not request issues, Actions,
administration, or secrets access. Install only on a disposable, owner-controlled test repository.

## Trust, events, and transactions

The API captures raw bytes before JSON parsing. It requires HMAC-SHA256 with the `sha256=`
prefix and compares decoded, equal-length digests using `timingSafeEqual`. Missing/bad signatures
return 401; missing delivery/event context and malformed bodies return 400. The 25 MiB limit
matches GitHub's documented webhook payload ceiling; oversized input receives the API's stable
`REQUEST_TOO_LARGE` error. Unsupported signed events receive 202 without a scan, including ping.

A persisted installation determines the tenant; webhook tenant fields are ignored. Unknown
installations return 403. New installations must first be bound by an authorized backend operator,
who verifies App access through GitHub. A webhook cannot create an arbitrary tenant binding.
For an install-created delivery that arrived before registration, redeliver it after registration.

Numeric GitHub repository IDs are stable identity. Names are mutable provider metadata.
A selected-repository event updates names by ID, removes access without deleting history, and
never grants access through a body tenant override. Suspended/deleted installations cannot enqueue,
materialize, or publish. Deletion retains audit, deliveries, repository rows, and completed results.
The operator synchronizer can refresh selected repositories after a rename. Account-login fields
are informational; personal-account installations do not require an `organization` webhook field.

Only PR `opened`, `synchronize`, `reopened`, and `ready_for_review` actions scan. The accepted
`pull_request.head.sha` is persisted. Branch push events use `after`; deleted branches, zero SHAs,
and tags are ignored. Fork PR commits that are not accessible through the authorized base repository
fail safely; the adapter never switches to an untrusted fork URL or different installation.

Delivery, installation/repository changes, scan/job/publication creation, and acceptance audit use
one Prisma transaction. `(organizationId, deliveryId)` is durable uniqueness, with `createMany`
`skipDuplicates` for concurrent delivery. Queue keys also include the tenant and delivery. A
transaction failure returns 503 and rolls back acceptance so GitHub can redeliver. No raw payload
is stored: only its hash, bounded event/action, numeric repository identity, PR number, ref/SHA,
correlation, installation/tenant, times/status and scan link. Queued work survives API restart.

## Acquisition and worker

GitHub work uses the existing queue, retries, cancellation, recovery, heartbeat and attempt fencing.
The job carries its installation ID and full SHA. At execution, the current tenant/installation/access
mapping is checked again. The GitHub repository API must return the persisted numeric repository ID.
The archive API is requested with the persisted SHA, never a branch name or later PR lookup.

App auth signs RS256 using an RSA private key of at least 2048 bits. Both GitHub's downloaded PKCS1
and PKCS8 PEM formats work; literal `\n` sequences are normalized in memory. JWT `iat` allows
60 seconds of skew and expiry is 9 minutes after issuance. Invalid keys fail startup when live
materialization is enabled. Installation tokens are requested only after ownership/access checks,
validated for expiry (at most GitHub's one-hour lifetime plus clock tolerance), held in memory,
and never cached, logged, saved in the database, or returned to users. There is no PAT fallback.

Runtime API origin is fixed to `https://api.github.com`. Constructor transport injection is used
only by tests; there is no environment-controlled generic downloader. JSON API redirects are
rejected. Archive redirects allow HTTPS `codeload.github.com`, standard port, no userinfo, and the
matching owner/repository path only. Authorization is removed on the archive redirect. Further
redirects are rejected. API requests have an 8-second timeout; the archive request/stream has a
60-second timeout and receives scan cancellation. Safe status errors omit provider response bodies.
GET/PATCH retry at most twice for 429/502/503/504 or transport reset. Bounded Retry-After delays
are honored inline; longer delays return to durable scheduling. POST is never retried inline.
401/403/404/422 are not blindly retried. Authentication failures stop publication pending review.

The existing workspace provider creates a unique non-user-controlled temporary directory and
cleans it on success, cancellation and extraction/scanning failure. Archives reject absolute paths,
Windows drives, `..`, escape after normalization, links (including symlinks and hardlinks), devices,
and unsupported entry types. Rejecting all links is deliberate: v1 does not preserve legitimate
symlinks. Extraction strips the provider's top-level directory; no repository scripts execute.

| Bound                                  | Default                                |
| -------------------------------------- | -------------------------------------- |
| Compressed archive                     | 250 MiB                                |
| Extracted regular-file bytes           | 1,000 MiB                              |
| Archive entries, including directories | 100,000                                |
| Single file                            | 100 MiB                                |
| Path depth / path length               | 64 / 4,096 characters                  |
| Scanner files / total bytes            | 10,000 / 100,000,000 by default        |
| Job wall clock                         | 120 seconds by default; max 15 minutes |

## Durable Check publication

Each GitHub scan creates one `GitHubCheckPublication`. The name is **AgentShield Security**;
`external_id` is the scan ID and `head_sha` is its immutable commit. The Check ID and published
state are persisted. Workers publish queued before claiming, in-progress from durable running state,
and completed after durable results. Publication is independent of the scan executor's result:
old attempts have no client through which to publish their own findings.

A per-scan PostgreSQL transaction advisory lock serializes publishers. On create uncertainty/crash,
the publisher reconciles the exact `external_id` on that SHA (bounded 10 pages), rather than choosing
by name alone, before creating. Retries update the persisted Check. GitHub does not expose an atomic
create-idempotency key: there remains a provider visibility/crash window after an unacknowledged create;
external-ID reconciliation minimizes it but cannot guarantee exactly-once remote creation under all
provider failures. This is an explicit provider limitation, not a second scan/job.

| Durable result                             | GitHub conclusion |
| ------------------------------------------ | ----------------- |
| All ALLOW / no findings                    | success           |
| WARN                                       | neutral           |
| REQUIRE_APPROVAL                           | action_required   |
| BLOCK                                      | failure           |
| Cancelled                                  | cancelled         |
| Exhausted execution/infrastructure failure | failure           |

Output is bounded summary counts, highest severity, policy version and scan ID. No evidence snippets,
raw secret values or provider bodies are included. No public dashboard report URL is invented.
Annotation expansion is deferred: summary-only output avoids line/path disclosure and bulk annotation
limits. A temporary publication failure records safe status and an audit event; durable scan results
stay intact. Scheduling backs off from seconds to 5 minutes, stopping after ten attempts or a
nonretryable provider error. No rescanning is required. After resolving revoked access/configuration,
an operator can explicitly retry publication using the command below.

Audit and delivery links answer tenant, installation, repository ID, PR/push, SHA, scan, worker attempt,
policy decision, Check ID and timestamps. The existing evidence/receipt/SARIF redaction remains in use.

## Owner setup and controlled live verification

1. Register the App with the permissions/events above. Generate a strong random webhook secret
   locally (for example `openssl rand -hex 32`) and generate its RSA private key in GitHub settings.
   Store credentials only in the approved backend environment, never Git, chat, screenshots, or a PR.
2. Supply the existing API and worker's `DATABASE_URL`, auth settings, and these exact fields:
   `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
   `GITHUB_SCAN_POLICY_BUNDLE_VERSION`. Enable `GITHUB_WEBHOOK_ENABLED`,
   `GITHUB_SCAN_LIFECYCLE_ENABLED`, and `GITHUB_MATERIALIZATION_ENABLED` together.
   `GITHUB_CLIENT_ID` is optional and unused by this App installation flow.
3. Install the App on the disposable test repository. Run from the configured backend:
   `pnpm github:operator register <organization-id> <numeric-installation-id>`.
   This verifies App ownership and discovers permitted repositories; it does not accept a PAT.
4. Start the existing API and worker. Set the App webhook URL to an established approved public
   HTTPS ingress. This environment supplies no public webhook ingress. Providing that endpoint is
   an external requirement; do not improvise a tunnel or commit an ephemeral tunnel URL.
5. Open a test PR with safe fixtures, note its head SHA and GitHub delivery ID, and wait for
   **AgentShield Security** to complete. Repeat with a controlled blocking fixture and cancellation.
   Redeliver the event and confirm one scan/job and the same Check. Move the branch after acceptance
   and confirm the accepted scan's original SHA is retained.
6. Run `pnpm github:operator verify-live <organization-id> <delivery-id>` from the configured backend.
   It verifies database lineage and the actual Check using installation auth and prints safe IDs and
   conclusion only. The normal CI simulator does not invoke this command or count as live proof.
7. After fixing stopped publication: `pnpm github:operator retry-check <organization-id> <scan-id>`.
   This schedules publication only; keep the worker running.

No private key, webhook secret, installation token, PAT, OIDC secret or database credential should
be pasted into chat. Real live validation is currently **BLOCKED BY OWNER/EXTERNAL CONFIG**:
no configured App credentials/test installation/public ingress are available to this task.

## Verification and security review

Normal CI uses signed real HTTP webhooks and a deterministic local GitHub HTTP server, real
PostgreSQL migrations, real queue/worker/scanner/policy/receipt and real tar extraction. It needs
no live provider credentials. `pnpm test:github-lifecycle` remains; `pnpm test:github-e2e` adds the
full controlled flow. Unit tests cover JWT format, bad auth status, redirects, archive attacks,
resource bounds, cancellation/cleanup and transport retries. Phase 2's 15 database security groups
and all baseline browser, integration, gateway, scanner and SARIF gates remain.

| Area                       | Review disposition                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Webhook authentication     | FIXED: exact digest bytes, raw body and malformed header handling                         |
| Replay/duplicate delivery  | FIXED: transactional durable dedupe and enqueue                                           |
| Tenant mapping             | FIXED: persisted installation, no payload tenant override/rebind                          |
| Installation authorization | FIXED: active state and selected access required                                          |
| Exact SHA acquisition      | FIXED: persisted SHA requested; remote numeric ID verified                                |
| SSRF                       | FIXED: fixed API origin and narrow credential-free archive redirect                       |
| Traversal                  | PASS: bounded normalized paths beneath unique workspace                                   |
| Symlinks                   | PASS: all links rejected; legitimate link preservation deferred                           |
| Resource exhaustion        | FIXED: bytes/entries/depth/time bounds                                                    |
| Token leakage              | PASS: memory only, safe errors and no credential output                                   |
| Evidence secret leakage    | PASS: existing redaction and summary-only Checks                                          |
| Worker fencing             | PASS: Phase 2 CAS result fencing; independent serialized publisher                        |
| Check idempotency          | FIXED: durable ID plus exact external-ID reconciliation; provider crash window documented |
| Retries                    | FIXED: bounded provider retries and independent durable publication scheduling            |
| Error safety               | PASS: normalized statuses, opaque external errors, no raw provider bodies                 |
| Audit lineage              | FIXED: delivery/PR/repository/SHA/scan/attempt/Check linked                               |
| Real provider evidence     | DEFERRED: owner/external configuration gate                                               |

Phase 4 infrastructure (managed database, Redis, storage, KMS/vault, production OIDC, telemetry,
SLO/backups, scaling, DNS and releases) is deferred. Phase 5 UI/onboarding/marketing/AI/compliance,
other SCMs and new scanners are deferred. Existing CodeQL SARIF upload and redaction gates are
preserved; runtime code-scanning publication is not required.

## References

- [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Webhook payload limits](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [App JWT authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Downloaded App private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- [Repository archives](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-tar)
- [Checks API](https://docs.github.com/en/rest/checks/runs)
