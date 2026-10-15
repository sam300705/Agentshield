# AgentShield implementation and acceptance plan

Checkpoint: 2026-10-15. The inspected Phase 1 follow-up head was
`d0247207641e5db8e2ab4f14a0036921aac594ec`, PR #16, targeting
`phase1/consolidate-stabilize` at `f996445bde6cde57011461c45a1fd8eb007518ab`.
Both exact-head quality workflows passed, but review found six defects.
Passing CI was insufficient. Independent acceptance remains pending.
The current candidate identity and CI belong in the PR publication record.

## Product decision

Hypothesis: platform/security teams managing consequential GitHub agent actions
need exact-action authorization enforced at a credential-controlled execution
boundary, with evidence of the decision and observed outcome. Buyer and repeated
need are unvalidated. Repository scanning supplies descriptive evidence.
The current cooperative SDK does not enforce provider execution. Do not advertise
the proposed boundary as an implemented guarantee. See [research](product-research-ledger.md)
and [proposed contracts](action-approval-execution-contracts.md).

## Work package P1-R1: close review defects

- Objective: prevent demonstrated evidence leakage, lost failure history, unsafe
  seed targeting and misleading coverage; preserve interoperable dependency IDs.
- Evidence: six reproduced defects on the inspected head; original PR threads
  are unresolved and three have outdated positions. See [failure register](phase1-review-fix-register.md).
- Scope: shared redaction/PURL validation, npm PURL construction, scan-job claim,
  seed entry point, YAML completion diagnostics, receipt/CLI/UI propagation.
  Exclusions: provider writes, new approval authority, deployment and later phases.
- Dependencies/components: existing schemas/scanner/API/dashboard/Prisma; pinned
  pnpm 9.15.4; disposable PostgreSQL. No orchestration replacement.
- Invariants: untrusted marker text grants no sanitization exemption; nested URL
  credentials are removed; actual locked failure state is archived atomically;
  seed writer uses its validated destination; parse failures cannot yield COMPLETE;
  absence of new receipt fields preserves legacy hashes.
- Reuse: INTEGRATE `packageurl-js` 2.0.1 (MIT, no runtime dependencies);
  EXTEND current scanner/transactions. See [ADR](adr-phase1-integrity-boundaries.md).
- Migration: no SQL changes. Optional `incompleteChecks` in existing coverage JSON.
  No historical receipt rewrite, backfill or customer-record cleanup expansion.
- Tests: genuine export/persistence canaries; scheduled PostgreSQL ABA and audit
  rollback; malformed/multidocument/template YAML; CLI/receipt/UI propagation;
  forbidden seed destinations; existing seed preservation/concurrency and upgrades.
- Acceptance: local checks, published exact-head CI, then independent review.
  The implementation assistant cannot award the last gate.
- Recovery: additive revert before acceptance; retain migration history and existing
  records. Older receipt readers may reject the new optional diagnostic field;
  keep compatible readers during rollback. Stop seed execution on target refusal.

## Phase backlog and gates

| Track              | Current status                                     | Required next evidence                                                                                         |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| R0 research        | PARTIAL: desk research and pilot protocol recorded | Actual team interviews, comparator trials, pilot outcomes and buyer evidence                                   |
| Phase 1 / #9 + #16 | PARTIAL: review remediation candidate              | Final-head CI and independent acceptance of that revision                                                      |
| Phase 2 / #10      | BLOCKED                                            | Accepted predecessor and authorized history-preserving integration; actual PostgreSQL authority races/rollback |
| Phase 3 / #11      | BLOCKED                                            | Accepted Phase 2; delivery qualification, then explicit ADR/scope for one bounded write                        |
| Phase 4 / #12      | BLOCKED                                            | Accepted Phase 3; tested artifact, isolated restore, configuration and operational evidence                    |
| Phase 5            | BLOCKED                                            | Accepted backend capabilities and Figma source; end-to-end usability evidence                                  |

Preserve #9 → #10 → #11 → #12. Do not merge, retarget or rewrite history.
Do not interpret root AGENTS.md's historical “Phase 8+” posture as permission to
skip these narrower user-defined gates. No production deployment is authorized.

## Architecture grounded in current code

Retain the TypeScript monorepo, shared Zod runtime contracts, Express, React/Vite,
TanStack, deterministic declarative policies and PostgreSQL/Prisma. Keep logical
modules in the monorepo: console; authenticated control API; bounded evidence;
decision/approval authority; durable coordinator; provider adapters; audit/verification;
operations. Separate deployment units when privilege or recovery requires it.

`scanQueue.ts` already supplies durable claims and lease ownership; this package
repairs its short claim transaction, with no HTTP added inside it. Later provider
work must use claim → remote HTTP → fenced finalization and reconciliation.
The existing Render blueprint points at `agent/production-hardening`, uses shared
runtime configuration and native builds, while CI builds a container. That inspected
configuration is not evidence of deployed artifact equivalence or privilege separation.
It remains unchanged; Phase 4 owns the correction and qualification.

The API's tenant/actor context is authoritative; repository text, scanner output and
model text are untrusted descriptive inputs. Approvals must bind the original
normalized action context, never a redacted label or mutable repository name.
Append-oriented application audit history still trusts the database administrator.
Hash/signature verification proves neither safety nor complete capture.

## Continuity

Use the existing ordinary checkout and additive development commits. Record failures
and exact published checks in the [handoff](phase1-flagship-followup.md) and PR #16.
After Phase 1 remediation and R0 desk work, the next dependent implementation task
requires independent acceptance. External research feedback and live credentials are
separate evidence gates; neither can be manufactured from fixtures.
