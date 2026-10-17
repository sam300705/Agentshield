# Phase 3 accepted-authority integration and delivery reliability

## Predecessor acceptance and scope

The owner instructed continuation in direct response to the Phase 2 acceptance
question for 17793743b2e38c73b0f6094c690d170ac09fb8dc. Record this as owner
acceptance of the no-findings automated code-review gate and exact-head passing
push/PR CI (39056753496 / 39056757039), not independent human or dedicated security
acceptance. Existing PR heads/bases and immutable migrations remain unchanged.

## Work package P3-I1

Objective: integrate existing Phase 3 head 49d2274c601a63b88aadcaa511526af1bb90946a
with the accepted authority foundation, preserving stronger security invariants.
Evidence: fourteen merge conflicts; old publisher performs remote HTTP inside a
60-second database transaction; newer ownership, archive, coverage, retry and
receipt fixes are absent from the old Phase 3 history.

Scope: history-preserving merge on phase3/accepted-authority-integration; reconcile
configuration/webhook/lifecycle/queue/materialization/schema/contracts; preserve
exact-intent approval and HELD/no-dispatch semantics. Existing GitHub delivery only.
Exclusions: create-ref write adapter, production changes, broad passthrough, merges,
new UI, dependent Phase 4 implementation and acceptance claims.
Dependencies: accepted Phase 2; existing Phase 3 code and synthetic provider fixture.
Files: API integration/runtime/worker/queue, schemas/migrations, CI and handoffs.
Invariants: tenant/actor boundaries; installation-before-repository lock ordering;
revocation invalidates new admission; exact immutable source; bounded acquisition;
actual lease/attempt fencing; atomic audit and evidence; compatible immutable history.
Reuse: EXTEND existing Express/Prisma/PostgreSQL/Node crypto/tar; investigate provider
SDK separately before replacement. No new infrastructure or dependency by default.
Migration: retain every parent migration byte; additive expansion only where needed.
Tests: unit, real PostgreSQL authority/security/upgrade/seed races, real synthetic
signed-webhook/archive/scanner/receipt/Check path, hostile/slow provider and browsers.
Acceptance: integrated exact-head CI and independent review; live provider is a
separate staging gate. Recovery: additive corrections/reverts, stop affected workers,
retain schema/history; no production migration/rollback performed.

## Work package P3-D1 (after integrated baseline)

Objective: short claim -> remote operation -> fenced finalization for Checks.
No transaction spans provider HTTP. Persist lease/generation and dispatch intent,
handle ambiguous creates by reconciliation before repeat; bounded backoff/budget
and no stale finalizer. Preserve cancellation/coverage and scan evidence. Tests must
pause actual provider calls while independent PostgreSQL connections operate and
prove stale/crashed publisher recovery. New schema only additive; old publisher must
be stopped before rollout. Provider write-action support remains separately gated.

Status: integration in progress; new local checks, published CI, independent review
and live provider qualification are NOT RUN for this candidate.

## Integrated baseline observations

PASS local: Prisma generation/validation, 201 API unit tests, ten authority PostgreSQL
groups (including deselected-repository refusal), and seven synthetic provider E2E
groups. The latter uses actual signed HTTP, PostgreSQL, tar acquisition, scanner,
policy, receipt and Check calls against a controlled simulator. Old fixture policy
version/cancellation identity/error assertions were reconciled with accepted contracts.
The supported webhook limit stays 1 MiB with 413 PAYLOAD_TOO_LARGE; do not interpret
GitHub's larger provider ceiling as an AgentShield supported limit.

Preserve webhook retry fencing when using transaction-safe createMany(skipDuplicates):
zero inserts must enter the previous payload/attempt CAS recovery instead of assuming
a duplicate claim succeeded. Authority derivation now shares installation-before-
repository ordering with selection/revocation and refuses deselected repositories.
All accepted HELD action operations remain without a dispatch consumer.

The imported Check publisher still spans HTTP with a transaction in this intermediate
local merge. P3-D1 must correct this before the integrated candidate is published or
accepted. No current code is asserted to meet that invariant until the correction
and genuine slow-provider/lease tests exist.
