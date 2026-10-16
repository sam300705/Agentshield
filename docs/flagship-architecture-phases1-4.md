# AgentShield production architecture through Phase 4

Audit checkpoint: 2026-10-14, Phase 1 base f996445bde6cde57011461c45a1fd8eb007518ab.
This is an implementation and acceptance design, not a public-release claim.
Preserve #9 → #10 → #11 → #12; no merges, retargets or history rewrites are authorized.

## Product contract

Build a trustworthy repository security and review control plane: collect bounded
static evidence from an immutable commit, evaluate deterministic policies, obtain
independent evidence-bound review, and publish a verifiable outcome. The cooperative
SDK supplies decisions and approval checks; it does not stop callers bypassing it.
Do not claim runtime protection, comprehensive CVE detection, or exactly-once external
execution. Flagship quality means observable guarantees, recovery and honest limits.

## Boundaries to retain

React/Vite/TanStack console → authenticated Express API → PostgreSQL authority.
Shared Zod contracts join scanner, declarative policy and deterministic remediation.
PostgreSQL owns jobs, leases, tenant relationships, approvals, evidence and publications.
Redis provides shared request budgets only. No broker or framework migration is needed.

Separate scan workers, provider publication, and signing privileges by responsibility.
Untrusted repository content cannot change gate exclusions or policy authority.
Temporary source is bounded and cleaned; no repository scripts run.

## Phase 1: trustworthy evidence and contracts

Current code inspection confirms unsigned configuration is allowed, repository scanning
is explicitly unavailable pending Phase 3, and gateway sessions must be ACTIVE and
actor-owned. Preserve those fail-closed boundaries.

This follow-up repairs dependency credential output/storage, OIDC openid validation,
configured signing validation at startup, stale retry metadata, latest-scan score scope,
TanStack SBOM rendering and queued demo admission documentation. A reader-only API
needs no signing key; supplied configuration is validated without logging key material.
Historical failures stay in audit records while current progress fields are reset.

This follow-up now implements session creation/read/closure with authenticated ownership
and shared locking with event ingestion, authorization and new approval creation.
Coverage propagates into CLI, persisted results, UI and receipts. Real disposable
PostgreSQL regressions verify seed preservation, rollback and concurrency. Final-head
CI and independent acceptance remain gates; these implementation results do not
establish live-provider qualification.
Do not call an internal skippedFiles array end-to-end coverage. An excluded directory
is not an enumerated count of skipped files. Report unavailable enrichment and partial
inspection explicitly. Retain raw action hashes in memory and sanitized display data.

Acceptance: final published-head checks, meaningful boundary regressions, populated
upgrade/data preservation, and independent current-commit security acceptance.

## Phase 2: integrated durable lifecycle

PR #10 is conflicting with newer Phase 1. First accept the predecessor, then reconcile
in an isolated branch using an explicitly authorized history-preserving method.
Preserve immutable SQL/checksums and ownership; never rewrite migrations to hide drift.
Verify fresh and populated upgrades, simultaneous claims/reviews, cancellation under
recovery locks, stale-worker fences, audit rollback and safe seed replacement.
Unique tie-breakers provide deterministic ordering, not snapshot consistency across
concurrent inserts/deletes. Choose cursor pagination for workflows needing stable traversal.

Acceptance: an integrated candidate containing predecessor fixes, actual PostgreSQL race
and rollback evidence, final-head CI, and independent acceptance. Four old green builds
are not one integrated release candidate.

## Phase 3: isolated GitHub delivery

The Phase 3 publisher currently performs remote calls inside a transaction and the
worker awaits publication around scan claiming. Provider latency can block authoritative
work and consume connections. Refactor to short claim → remote request → fenced finalize.
Persist publication leases/generations, release DB locks before HTTP, and reject stale
finalizers. Serialize by scan, use stable due ordering, bounded concurrency/backoff,
and reschedule unchanged state so old candidates cannot starve terminal publications.

Use separate create/update payloads. Treat uncertain successful response parsing as
recoverable and reconcile exact external IDs before another create. Preserve provider
ID precision throughout parsing/storage/transport; string storage alone is insufficient.
Validate permissions and installation ownership. Version repository snapshots against
selection/revocation events and recheck authority before acquisition/publication.
Pagination must prove completeness without silent truncation. Persist webhook admission
before acknowledging; provide failed/missed-delivery recovery. GitHub does not guarantee
automatic redelivery. Required-check rules and bypasses need controlled live verification.

Acceptance: synthetic hostile/slow-provider faults plus real App install, webhook, pinned
archive, scan, receipt and Check evidence. Record safe identifiers only.

## Phase 4: tested release and recovery

Current Render blueprint shares receipt secrets with the API and uses a native artifact
while container CI tests another artifact. Separate API/worker/publisher/migration
credentials; no signer private key or direct migration credentials in reader-only services.
Build once, test/scan the artifact, identify digest/source SHA, deploy that artifact.
Record current vulnerability disposition rather than claiming vulnerability-free images.

Align hosting termination windows, scan deadlines and fenced interruption recovery.
Lease duration is not execution timeout. Install correlation/observation before probes,
retain cheap liveness, bounded DB readiness, and independent provider/limiter alerts.
Verify Redis fixture readiness before startup and real shared budgets across replicas.
Use nonroot/read-only/private bounded scratch where supported and narrow exact origins.

One controlled migration step uses restricted direct credentials; never seed production.
Prefer additive schema changes and compatible rollback. Restore into isolation, verify
migration history/tenant constraints/receipts, then reconcile external side effects before
resuming. Define and measure RPO/RTO, queue latency, supported repository size,
per-tenant fairness, connection budgets and costs; none are achieved claims yet.

Acceptance: final artifact smoke and security checks; real OIDC/GitHub, key rotation,
alert delivery, isolated restore and rollback evidence; independent review and explicit
owner authorization before production. Configuration and live evidence remain separate.

## Execution discipline

Close Phase 1 defects first. Later phase designs can be reviewed now, but dependent
implementation waits for predecessor acceptance. No Phase 5 visual expansion is included.
Maintain a finding → invariant → regression → commit → CI → acceptance register.
