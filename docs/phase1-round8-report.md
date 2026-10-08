# Phase 1 Round 8 — security remediation and release handoff

## Scope and source

Authorized phase: Phase 1 only, on `phase1/consolidate-stabilize` (PR #9).
Review basis: the ten new findings raised against commit
`245523287233515d8325e3ce34247853ec0acadc`.
This report is an implementation handoff, **not** independent acceptance.
No downstream PR was merged, rebased, retargeted, or advanced.

## Root causes and remediations

### Redacted event replay collisions

Store a nullable SHA-256 commitment for canonical unredacted event input, without storing the preimage. Changed secrets conflict on replay; legacy NULL records require a fresh idempotency key.

### Seed cleanup ownership

Scope all seed cleanup mutations to the marked demo scans and preserve other organization and unmarked records.

### Incomplete OSV responses

Reject incomplete or malformed successful batch results instead of returning false-clean dependency findings.

### Archive directory exhaustion

Count accepted directories as well as files toward the extraction entry budget.

### Terminal session events

Check ACTIVE session ownership again inside the event transaction before inserting any event.

### Gateway audit coverage

Write tenant-scoped POLICY_DECIDED audit evidence before returning permissive gateway results.

### Canonical receipt exports

Reconstruct unsigned receipts from persisted scan metadata, parse signed payloads, and validate receipt hashes before responding.

### Approval resource redaction

Sanitize new and historic approval resources and reasons; validate their post-redaction schema size.

### Exact CORS origin validation

Reject CORS values containing paths, queries, fragments, credentials or an unexpected scheme. Require HTTPS in production.

### Azure worker configuration

Supply the configured CORS_ORIGIN to the scheduled worker as required by current startup validation.

## Migration and compatibility

Added only `prisma/migrations/20261008130000_agent_event_raw_digest/migration.sql`.
Prior SQL files/checksums remain unchanged. The new field is nullable so existing
audit/events survive and are not rewritten. A legacy row has no trusted raw
identity commitment and cannot be safely matched to a fresh retry. Clients
must use a new event idempotency key for those historic events.
No migration should run automatically on normal API startup.

## Verification contract

- GitHub Actions: inspect the final published commit's workflow and its actual
  PostgreSQL migration, regression, browser, SARIF and Docker results.
- Local environment: checkout and pnpm dependencies unavailable to this agent;
  do not claim local tests.
- Independent security acceptance: still required, not implied by green CI.
- Live OIDC, GitHub App and deployment qualification: out of this phase and
  not claimed.
- Outstanding Phase 2/3/4 findings remain in their respective open PRs.

## Failure and fix log

- Historical problem: evidence sanitized *before* identity hashing could
  equate distinct raw commands. Raw SHA-256 identity is now stored separately
  while immutable displayed/stored evidence stays redacted.
- Historical problem: a local seed reset deleted non-demo scans. Cleanup now
  targets only the labelled demo scan graph.
- Historical problem: malformed OSV success payloads looked like a clean scan.
  Invalid batch results now raise an explicit error.
- Git transport limitation during this remediation: the execution sandbox
  could not resolve github.com for `git ls-remote`. Authorized GitHub connector
  updates and GitHub-hosted CI were used instead of inventing local results.

## Next gate

Recheck each current-head review finding, verify latest CI on the final
published commit, and complete the required independent review. Only after
Phase 1 acceptance may Phase 2 be integrated. Preserve
PR #9 → #10 → #11 → #12; do not rewrite history.
