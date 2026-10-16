# Phase 2 integration and acceptance handoff

## Accepted predecessor and integration authority

The owner explicitly accepted the no-findings automated Codex code review of
`95de63e15eec93916c96597e2b17050a751e84c3` as Phase 1's independent review gate
and authorized a new development branch with a normal merge commit. This records
owner acceptance of automated evidence; it does not claim human security acceptance.
Both exact-head quality runs passed: 38861966335 and 38861971420. A dedicated
security-review request is also pending on PR #16; its result must be monitored.

Phase 2 starts from PR #10 head `f22615be02296912d30d66536b7b3cd0468c714b`.
The accepted Phase 1 candidate is merged into `phase2/accepted-foundation-integration`.
The existing PRs #9 → #10 → #11 → #12 and follow-up #16 retain their heads/bases.
No PR is merged or retargeted, no history rewritten, and no deployment performed.

## Work package P2-I1: accepted-foundation integration

- Objective: reconcile both histories while preserving accepted Phase 1 safeguards.
- Evidence: 14 conflicted files, older Phase 2 lease-owner-only fencing, and a distinct
  backend-integrity migration absent from the accepted Phase 1 history.
- Scope: auth/RBAC/input boundaries, tenant composite constraints, atomic scan
  transitions/audits, scan enqueue replay conflicts, and real PostgreSQL regressions.
- Exclusions: provider write adapters, production configuration, UI expansion, and
  claims that cooperative agent authorization enforces provider execution.
- Dependencies: owner-accepted predecessor and authorized ordinary development merge.
- Components: API controllers/auth/queue/scan persistence, Prisma schema, CI and
  database-upgrade rehearsal. Shared schemas retain Phase 1 compatibility.
- Invariants: session ownership and closure locking; atomic decision/approval/audits;
  actual claim fencing and monotonic claim history; redaction/coverage/receipts;
  seed import safety and customer preservation; immutable migration files.
- Reuse: EXTEND existing Express/Prisma/PostgreSQL coordinator and Zod contracts.
  No orchestration/policy framework replacement or new dependency is needed.
- Migration impact: retain every migration from both histories byte-for-byte.
  Apply missing migrations on populated predecessor schemas and reject incompatible
  data without deleting or silently repairing customer rows.
- Tests: unit/workspace checks, real PostgreSQL backend security, Phase 1 completion,
  lease takeover, upgrade and drift refusal, gateway/GitHub synthetic lifecycle,
  browser tests and CI artifact/source checks.
- Acceptance: exact published candidate CI and external review. This package alone
  does not complete Phase 2's durable action/approval/admission contract.
- Recovery: additive corrective commits/reverts; retain migration/history tables.
  Drain old workers before claim-sequence upgrades; no production rollback performed.

## Remaining Phase 2 work

Implement versioned exact-context action, decision, approval and durable admission
contracts from the proposed architecture; validate evidence/commit/policy freshness;
expiry/revocation and reviewer independence; atomic one-operation consumption and
outbox admission; closure/cancellation/audit rollback races. Do not expose a generic
provider API or mark Phase 2 accepted before the integrated candidate qualifies.

## Evidence register

Local verification of P2-I1: PASS for 404 workspace tests, 15 actual PostgreSQL
backend-security groups (including same-name overlapping workers), accepted Phase 1
completion regressions, lease takeover, round2, gateway, synthetic GitHub lifecycle,
legacy baseline/drift refusal, populated upgrades from both predecessor histories,
Prisma validation/generation, formatting, lint, typecheck, build, docs and six browser
tests. Migration bytes were compared against both parent commits and are unchanged.

Local container build: BLOCKED by container egress, not accepted as a pass. The
pinned base Node image's direct npm tarball request fails with ECONNREFUSED. Host
frozen-lockfile installation passes. No TLS/signature/integrity checks were disabled.
Published exact-head CI remains pending until this candidate is pushed.

Integration corrections: preserve Phase 1's owner+actual-attempt fence instead of
Phase 2's older owner-only interface; issue a fresh token per invocation even for
reused worker names; forbid expired renewal; finalize scan/job/evidence/receipt
atomically; retain bounded sanitized retry history. The round2 regression now proves
unclaimed job execution is rejected, then uses the real coordinator and separately
checks authenticated requester versus worker audit identity. It cancels its own
synthetic GitHub admission after checking identity so that unrelated fixture work
cannot mask the intended demo execution. OIDC regression claims are explicitly
configured rather than depending on ambient .env defaults.

The baseline rehearsal removes full-line comments before its existing simple-DDL
split so an immutable Phase 2 migration's comment semicolon cannot break rehearsal.
This remains a helper for the reviewed committed DDL, not a general SQL parser.

Local and published results are recorded after execution, not inferred from old CI.
Live OIDC/provider credentials, staging execution and production remain unverified.
