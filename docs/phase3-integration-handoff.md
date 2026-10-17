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

Package-start status (historical): integration was in progress and new checks were
NOT RUN. Later evidence checkpoints below supersede this observation.

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

## P3-D1 implementation and local evidence checkpoint

The intermediate publisher has now been replaced: short claim, committed lease and
monotonic generation/possible-create marker, remote HTTP outside database transactions,
and atomic unexpired fencing before projection/delivery/audit finalization. No claim
of provider-side generation fencing is made. A possible but invisible create stays
UNKNOWN, reconciles without re-creation, and stops after ten attempts. Old null-ID
publications are conservatively UNKNOWN on additive upgrade; known IDs survive.

Provider tokens narrow immutable repository IDs and permissions separately for scan
and Checks. Decimal-string IDs outside this numeric adapter's supported safe range
fail closed; they are not rounded. Official GitHub token docs were read on 2026-10-17:
https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
Repository access and permissions are checked in the real HTTP simulator; live token
qualification is still NOT RUN. Tenant lanes, bounded batches/backoff and poll wakeups
are implemented; production fairness/throughput are not measured. Shutdown cancels
provider requests; remote already-accepted effects cannot be recalled.

PASS local at this checkpoint: eleven actual HTTP/PostgreSQL GitHub groups, including
a paused response with independently acquired publication/job locks, live-lease
exclusion, cancellation/generation takeover and rejected stale finalization, actual
post-provider audit failure/rollback and reconciliation, invisible-create budget
exhaustion without duplicate create, and valid-hash partial evidence refusing success.
The old publisher failed the same lock probe before correction (only its token scope
call was adapted to the current simulator); the corrected publisher passes. Four
populated predecessor upgrade histories pass, including preserved HELD action records.
Current final-source full quality, PostgreSQL, browser and exact-head CI/review are
recorded only after execution; these targeted results do not imply that gate is done.

Current live qualification blocker: no approved test installation/webhook ingress or
provider credentials have been used. No GitHub App secret, production configuration,
external repository action, production migration/deployment or protected branch write
was changed. Phase 4 and any create-ref adapter remain gated.

Claim-attempt audit completion: GITHUB_CHECK_CLAIMED commits atomically with lease,
generation, request digest and possible-create marker, before HTTP. A separate
additive migration introduces the label; expanded shared audit contracts also admit
existing lifecycle/authority labels without dropping legacy values. Claim audit
failure must roll back the claim and prevent every provider HTTP call. The new real
trigger regression and actual 20-item tenant-lane selection test extend the GitHub
suite to thirteen groups; final execution results are recorded below when complete.

## Final local P3-D1 checkpoint (2026-10-17)

PASS: 444 workspace unit tests (213 API), typecheck, lint, formatting, build,
document consistency, source scanner/SARIF validation and six existing browser
tests. PASS: thirteen real HTTP/PostgreSQL GitHub groups, ten authority groups,
fifteen backend-security groups plus redaction/expired-finalizer regressions, legacy
baseline/drift refusal, all four populated predecessor histories, Phase 1
lifecycle/seed/retry/receipt/coverage completion, lease takeover, round2, gateway,
synthetic GitHub lifecycle and CLI integration. No committed parent migration or
lockfile bytes changed. The final provider-contract correction was followed by a
fresh full unit/build run and thirteen-group GitHub run; unrelated PostgreSQL
results are retained rather than redundantly rerun.

Two provider-contract regressions also failed before correction: PATCH included
create-only head_sha, and duplicate matching external IDs on separate pages returned
the first ID. PATCH now omits that field; lookup scans its bounded pages and refuses
ambiguous identities. The HTTP simulator rejects the old PATCH shape, and an
ambiguous lookup retains UNKNOWN instead of clearing dispatch uncertainty.

Published P3-D1 exact-head CI/review: PENDING until this local candidate is pushed.
Phase 3 acceptance: PENDING. Controlled live GitHub: BLOCKED. Presence-only checks
confirm GITHUB_APP_ID, GITHUB_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET are absent in
the current environment; no controlled test installation/HTTPS ingress was supplied.
Local container build remains unqualified because of the earlier container egress
restriction; a new published-head CI container build is required.

Next bounded Phase 3 work after current review: qualify the operator verify-live
diagnostic against actual HTTP/PostgreSQL, including read-only scoped credentials,
exact provider ID and receipt/conclusion consistency. No live qualification or
production readiness may be inferred from the currently unexercised diagnostic.
Phase 4, production deployment and any create-ref adapter remain gated.
