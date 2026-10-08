# Phase 1 Round 8 — security remediation and release handoff

## Scope and source

Authorized phase: Phase 1 only, on `phase1/consolidate-stabilize` (PR #9).
Review basis: the ten new findings raised against commit
`245523287233515d8325e3ce34247853ec0acadc`.
This report is an implementation handoff, **not** independent acceptance.
No downstream PR was merged, rebased, retargeted, or advanced.

## Root causes and remediations

| Finding | Fix and regression |
| --- | --- |
| Redacted agent-event replay collisions | New nullable `AgentEvent.rawPayloadHash` stores SHA-256 of the canonical unredacted event input without storing the preimage. Replay matches only the stored raw hash; historical NULL rows fail closed and require a new idempotency key. Unit coverage exercises different secrets with identical redactions and legacy replay. |
| Seed cleanup deletes other users' data | Cleanup now filters **every deletion** by both `demo-organization` and the `phase-2-seed` scan marker. Other tenants and unmarked local records survive. Scope assertions are in `seedCleanup.test.ts`. |
| Missing OSV results silently appear clean | Batch response length, entries, vulnerability arrays and IDs are validated. Malformed successful HTTP responses fail enrichment rather than producing empty advisory arrays. Regression covers truncated and malformed replies. |
| Archive directory exhaustion | Archive extraction enforces an entry budget including directories, not just regular files. Regression rejects directory-only floods. |
| Post-terminal event writes | Both the owner lookup and the transaction-locked session lookup now require ACTIVE status; terminated sessions cannot append or replay events. Regression covers the terminal path. |
| Permissive decisions lack an audit | The gateway records tenant-scoped `POLICY_DECIDED` with safe metadata before returning, independent of caller event submission. Controller regression verifies the audit call. |
| Receipt export lacks canonical fields | The API reconstructs the canonical receipt from durable scan/receipt metadata when unsigned, parses the signed payload when present, and checks the persisted hash before return. Missing or inconsistent evidence produces an explicit 409 rather than an unverifiable success. Regression verifies unsigned hash integrity. |
| Approval resources leak via direct reads | Sanitize resources before persistence, sanitize historical values at every service-return boundary, bind identity to the original action digest, and validate the post-redaction contract before transaction. Review reasons are also sanitized before persistence. Tests cover sensitive new/legacy resources and redaction expansion. |
| CORS accepts non-origins | Require an exact bare HTTP(S) origin, with HTTPS mandatory in production. Configuration regression covers paths, queries, credentials, fragments, trailing slash and HTTP. |
| Azure scheduled worker missing configuration | Worker command now supplies the exact configured `CORS_ORIGIN` required by Phase 1 startup validation. |

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
