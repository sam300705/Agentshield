# AgentShield Control Plane Design

## Decisions

### PostgreSQL-backed worker instead of Redis

AgentShield already requires PostgreSQL and its demonstration workload is modest. `ScanJob` adds durable state, idempotency, atomic claims, progress, cancellation, retry timestamps, lock ownership, and bounded exponential backoff without introducing another operational dependency. If measured queue contention becomes material, the worker interface can move to BullMQ without changing scan-domain contracts.

### Integrity is tamper-evidence, not identity

Events are sorted by sequence. Sensitive evidence is redacted, the prior event hash is attached, and SHA-256 is calculated over canonical JSON. Verification detects insertion, removal, reordering, or mutation. The chain is not a signature and does not prove which human or agent produced an event.

### Deterministic graph derivation

Event nodes are connected by observed order. Events sharing a stored correlation ID use `CONFIRMED` edges; proximity-only relationships are `INFERRED`. Resource edges exist only when an event names the resource. Every edge carries a human-readable explanation. Blast radius is the sum of documented event-risk weights and eight points per unique resource, capped at 100.

### Immutable policy simulation

Policy Time Machine accepts stored findings, original decisions, and a validated target bundle. It evaluates ordered rules, stores condition-level traces, and returns deltas. It never updates `PolicyDecision`; results belong to `PolicySimulation` and `SimulationDecision`.

### Identity boundary

Roles are Viewer, Developer, Security Reviewer, Policy Administrator, and Organization Administrator. Permission checks execute in API middleware. Independent review requires both `approval:review` and an actor ID different from `requestedBy`. The current demo header resolver is isolated and must be replaced by a verified OIDC adapter in production.

## Data and tenant isolation

Organizations own memberships, repositories, sessions, policy bundles, simulations, integrations, baselines, scans, and audit events. Composite unique constraints prevent duplicate event ingestion and policy versions. API repository access must always include the resolved organization ID; IDs alone are not authorization.

## Scanner safety

- Never execute scanned code.
- Resolve the real root path and reject any resolved file outside it.
- Skip symlinks and binary/non-text content.
- Enforce per-file, total-byte, file-count, and timeout limits.
- Treat ignore patterns as relative prefixes, not shell expressions.
- Redact evidence before logging, persistence, JSON output, or SARIF.

## Worker state machine

`QUEUED → RUNNING → COMPLETED` is the normal path. A failure becomes `FAILED` with a bounded retry timestamp; attempts use exponential backoff capped at 60 seconds. Exhausted jobs retain failure code/message. Cancellation is a persisted request and becomes `CANCELLED`. Workers claim with a conditional update so only one process owns a job.

## Migration guidance

The reviewed PostgreSQL baseline is committed at `prisma/migrations/20260819000000_control_plane`. CI applies it with `prisma migrate deploy`; do not use `db push` against production. For an existing pre-migration demo database, back up the data and reconcile or baseline the database before deploying this initial migration.

## Remaining production work

- Replace demo identity resolution with OIDC and short-lived sessions.
- Add signed receipts if non-repudiation is a requirement.
- Add object storage with retention policy for large evidence artifacts.
- Add webhook signature verification and installation lifecycle for a GitHub App.
- Benchmark queue contention before selecting a distributed queue.
- Add browser E2E in an environment that provides Chromium and PostgreSQL.
