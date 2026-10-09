# Phase 1 Round 9 — implementation, failures, and acceptance handoff

Date: 2026-10-09. Branch: `phase1/consolidate-stabilize` (PR #9).
Preserve the open stack: #9 Foundation -> #10 Backend -> #11 GitHub -> #12 Runtime.
No PRs were merged, retargeted, rebased or force-pushed. No live services were deployed.

## Verified baseline

The earlier remediation head `d98c8b5e2fb50ad2cb364203e64fd35c8fd26c4c`
passed the complete `AgentShield CI` run 37923228426, including its quality job,
PostgreSQL migration/seed, unit/security integration, browser workflow, and build.
This is an **intermediate** head, not final acceptance for subsequent commits.
Review fresh results on the **latest** PR #9 head before claiming PASS.

## Round 9 source changes

- Agent SDK authorization now checks a canonical raw action digest on **every**
  decision before allowing execution. The API returns the request digest for
  all rule outcomes; stale or action-swapped permissive decisions fail closed.
- Agent SDK human approval matching uses the raw digest instead of comparing
  the server's intentionally redacted display resource to the original resource.
- Sensitive JSON property names (for example `password`, `apiKey`, and
  `client_secret`) cause nested evidence values to be redacted before audit
  persistence; original input remains bound to an in-memory digest.
- OSV detail responses must match the requested advisory ID and have a valid
  affected array; malformed detail responses fail enrichment rather than
  inventing clean dependencies.
- Agent event summaries are sanitized before inclusion in the stored
  integrity chain; replay identity remains bound to raw input.
- Signed receipt verification requires a string key identifier.
- Canonical JSON key ordering uses code point comparison, not host locale.
- Shared pagination caps page values to prevent unsafe Prisma offsets.
- OIDC login and logout URL construction preserve configured provider
  query parameters through URLSearchParams.
- Scan execution now propagates a lease fence containing the worker owner and
  attempt number through the queue, executor, and persistence service. The
  start/completion/failure paths check the current live lease with a PostgreSQL
  row lock before writing scan results. A missing or superseded lease fails
  closed. Direct non-queued demo runs have no worker fence.
- Added new unit regressions for action reuse, sanitizer key awareness,
  malformed OSV details, invalid receipt IDs, Unicode canonicalization,
  oversized pagination, OIDC redirects, raw event summaries and lease mismatch.

## Important acceptance gaps

1. **Real concurrent-worker qualification**: Unit coverage proves rejection
   when a lease lookup returns no row; it does not prove a real PostgreSQL race
   with worker A stalled, lease recovery/worker B takeover, and worker A's
   late failure/completion. Add deterministic controlled synchronization and
   verify scan/receipt/audit consistency and ownership at each transition.
2. **Independent security review**: Existing unresolved review threads include
   historical comments and new findings. Reassess each on the actual final
   source; do not treat thread counts as proven current defects.
3. **Live provider readiness**: Real OIDC login, GitHub App installation/check
   publication, signing-key custody, Redis, staging PostgreSQL, backup/restore
   and production deployments are not established by synthetic CI.
4. **Stack divergence**: Phase 2 branch still requires reconciliation with
   the approved newer foundation, without history rewriting or merging.
5. **SDK enforcement limit**: A canonical digest prevents decision reuse and
   accidental action substitution in a cooperative SDK. It is **not**
   tamper-proof enforcement against a malicious client capable of forging its
   own decision. Trusted execution requires a separately scoped architecture.

## Recorded failures and resolutions

- First remediation CI: TypeScript errors from a duplicate fixture field,
  a Vitest mock type and an extra result property. Fixed without weakening
  type checking.
- Intermediate CI: multiple Prettier issues. Fixed the exact reported paths
  while preserving `pnpm format:check`.
- Prior head `f6313c21`: one archive entry-budget test failed while removing
  a directory still being written asynchronously (ENOTEMPTY). Added bounded
  cleanup retries to the failing fixture, aligned with the existing production
  cleanup pattern. The complete CI at `d98c8b5` passed afterward.
- No data was erased, earlier migration SQL was not rewritten, and no
  security gate was bypassed.

## Astra review request and next gate

Review the final PR #9 diff and latest CI run; prioritize the worker
lease-fencing race and action-digest trust boundary. Add real PostgreSQL
concurrency regression coverage for expired-owner writes, retries and
cancellation; inspect the existing queue's locking ordering for deadlocks,
false retries or duplicate evidence. Validate backward compatibility with
`AgentEvent.rawPayloadHash` nullable historical rows and old SDK clients.
Check sanitizer output, malformed OSV payloads, signed receipt key attribution,
browser auth redirects, seeded data isolation and deterministic hashes.
Provide line-specific blocking findings, tests, residual risks and a
PASS/FAIL/PARTIAL/BLOCKED disposition. Do not merge or deploy.

Only after this phase has final-head CI PASS **and independent security
acceptance** should Phase 2 integration proceed.
