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

## Phase 2 candidate status

P2-I1 is published with additive review corrections (see
[the fix register](phase2-review-fix-register.md)). P2-A1 below implements the bounded
versioned exact-intent, independent-review and HELD admission contract. Its final
published-head CI and independent acceptance remain pending. No Phase 3 integration
or provider adapter is authorized by this handoff; the owner accepted Phase 1 only.

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
Corrected P2-I1 head `22fb3af447df027468883389295cc10863dc2268` passed both
published quality runs: push 38954184319 and PR 38954192858 (405 workspace tests,
PostgreSQL/browser/source/container checks). This evidence does not cover the
unpublished P2-A1 changes below; their exact-head CI and review remain pending.

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

## Work package P2-A1: authorization-only exact intent and durable admission

Objective: replace reusable cooperative approval assumptions with a versioned,
server-owned exact-context admission primitive. Existing legacy SDK endpoints remain
compatible and explicitly cooperative; their approvals cannot admit a durable action.

Scope: strict versioned request/decision/approval/admission schemas, server-derived
GitHub repository/installation identity and immutable scan-receipt binding; current
policy revision, expiry, independent review, revocation, one-operation consumption,
durable HELD outbox and cancellation. All provider dispatch remains disabled. A
`GITHUB_CREATE_REF` intent describes the existing proposed narrow candidate; it does
not activate that operation. Phase 3 must separately accept the adapter ADR/scope,
provider preconditions, credential boundary and staging evidence before any HTTP write.

Components: packages/schemas, API authority service/controllers, additive Prisma
models/migration, declarative policy contract and genuine PostgreSQL security tests.
Reuse: EXTEND existing Zod/Prisma/PostgreSQL/audit/canonicalization. No new dependency.
Dependencies: P2-I1 integrated foundation, accepted Phase 1, existing authenticated
actor/permission model, server-produced immutable scan receipts. No provider credential.

Invariants: no tenant/actor body override; immutable provider IDs and full commit;
strict ASCII ref namespace and no ambiguous encodings; server-derived receipt hash
and coverage/freshness; policy change invalidates unconsumed approvals; independent
reviewer; shared session lock for closure/admission; approval consumption, operation,
outbox and audit commit together. Same-operation replay is read-only after closure,
expiry or policy changes; a different operation cannot reuse consumption. Audit
failure rolls every authoritative mutation back. No HTTP inside transactions.

Privacy: store only the narrowly typed repository/ref/commit/evidence identifiers,
review reasons after redaction, and context digests under tenant access control.
Refs can reveal customer information and hashes are not anonymization. Reject known
credential forms; no arbitrary command text, credentials, model content or raw tool
output enters authoritative context. General retention/export is deferred, not claimed.

Migration: additive tables only, no mutation or reinterpretation of legacy approvals,
receipts or migrations. SQL owner constraints guard cross-tenant parents. Recovery:
additive code revert, disable admission policy, retain schema and audit history; no
production migration/deployment. Tests: real PostgreSQL concurrent consumption,
review/closure/revocation, audit failure, tenant/actor/parameter/evidence/commit/policy
changes, expiry, durable replay and cancellation. Acceptance: final integrated exact-
head CI and independent review; not self-awarded acceptance or live execution proof.

## P2-A1 local proof and limitations

The dedicated PostgreSQL suite exercises ten groups: real signed OIDC/RBAC and
configured foreign tenants; strict normalization and duplicate/ambiguous JSON;
legacy SDK approvals refused; full commit/immutable provider IDs including values
above JavaScript's integer range; exact-context independent review; same-key and
distinct-key concurrent consumption; policy change-back, expiry and revocation;
actual audit-failure rollback of policy/submission/review/consumption/outbox/cancel;
receipt tampering and valid-hash stale/partial evidence; suspended installation and
changed provider identity; expiry while waiting on a real repository row lock;
revocation versus consumption; closure versus admission using the actual HTTP close
controller and PostgreSQL barrier. No test is live GitHub qualification.

Input/action normalization and all storage/audit operations use the existing pinned
packages. No dependency or lockfile change. HELD has no provider consumer and is not
an external execution attempt; it cannot be promoted automatically on a later upgrade.
The API returns dispatchEnabled=false and NOT_DISPATCHED, including cancellation/replay.
The dashboard and legacy SDK do not expose this new authority API yet.

Reviewer role is verified from the authenticated request at review time and recorded
in its audit. Continuous external IdP role revocation/introspection is not implemented.
Use explicit approval revocation or a new policy revision; approvals otherwise expire
within ten minutes and evidence must remain under thirty minutes old. The future
provider adapter must requalify provider authority and preconditions. Ref absence is
an obligation in the intent, not a claim that GitHub was queried or locked.

No new action-outcome receipt/signature, provider write, production secret/config,
deployment, live provider guarantee or human security acceptance is claimed.

## Final local verification checkpoint (2026-10-17)

PASS: 414 workspace unit tests, six Chromium browser tests, typecheck, lint,
formatting, build, capability/document consistency, and repository SARIF source
gate/validation. PASS: action-authority (10 actual PostgreSQL groups), backend
security (15 groups plus persisted-source/expired-finalizer regressions), legacy
database baseline/drift refusal, populated upgrades from both accepted Phase 1 and
existing Phase 2 histories, Phase 1 completion/seed preservation, lease takeover,
Phase 1 round2, cooperative gateway, and synthetic GitHub lifecycle suites.
The database is isolated PostgreSQL 16 on loopback; tests use only synthetic data.

Published P2-A1 CI: PENDING. Fresh independent P2-A1 review: PENDING. Phase 2
acceptance: PENDING. Phase 3 integration: BLOCKED on that acceptance. Live GitHub,
external IdP revocation, staging qualification, mixed-binary production rollback,
backup restoration, load/cost measurements and production deployment: NOT RUN.
The six existing browser tests do not cover a new action-authority UI; none exists.

## Published candidate and follow-up review correction

Implementation head `b57fa8c48ae289de2fcc7f7a107baf33ee524f33` passed both
published CI runs: push 39056203892 and PR 39056206001. The completed PR job log
confirms 414 workspace tests, the ten authority/fifteen backend PostgreSQL groups,
all upgrade/lifecycle/seed regressions, six browsers, container/startup/build/source
checks. This supersedes the earlier local checkpoint's pending-CI observation for
that head only. It does not qualify a later correction automatically.

The fresh Codex review then identified an absolute-form HTTP target ambiguity-check
bypass (4303856429). It was reproduced with actual signed HTTP and corrected by
mounting the verified parser on Express's pathname-matched authority prefix. See
[the failure/fix register](phase2-review-fix-register.md). The new regression fails
before correction (201 instead of 400) and all ten authority PostgreSQL groups pass
after correction. Final correction-head CI and a fresh review remain required;
Phase 2 acceptance and Phase 3 integration are still pending/blocked respectively.

## Owner acceptance and Phase 3 continuation

Final head 17793743b2e38c73b0f6094c690d170ac09fb8dc passed exact-head push/PR
CI 39056753496 / 39056757039. The completed PR log confirms 414 workspace tests,
all PostgreSQL suites and six browsers. Current Codex automated code review completed
with no findings; dedicated security-review completion remains unconfirmed. The owner
then instructed “Keep on doing continue but don't deviate from path” in direct response
to the concrete acceptance question. This is recorded as owner acceptance of that
automated gate and authorization for history-preserving Phase 3 development, not human
security review, live-provider qualification or deployment authorization. See the
[Phase 3 handoff](phase3-integration-handoff.md) for current work.
