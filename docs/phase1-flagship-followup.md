# Phase 1 flagship integrity follow-up

Base: f996445bde6cde57011461c45a1fd8eb007518ab. Date: 2026-10-14.
New isolated branch: phase1/flagship-integrity-followup; target Phase 1.
No existing branch/PR is merged, retargeted or rewritten. No production changes.

## Changes

- Shared redaction handles URL userinfo and encoded package URL versions. CLI JSON/JSONL advisory output is sanitized; dependency persistence is sanitized after analysis. Original inventory remains available in memory for analysis/enrichment. Date fields retain ISO serialization.
- Signing settings validate pairing, key ID, PEM and Ed25519 algorithm before startup and at signing. Missing/blank settings remain unsigned. Reader-only services do not require private keys; errors never contain key material.
- OIDC configuration requires the exact openid scope for environment and direct constructors.
- Retry claim/completion clear current failure fields; historical failure audits are preserved.
- Latest scan grade uses latest scan counts; organization history keeps its separate grade. Latest scan selection has a unique tie-breaker.
- Live SBOM uses TanStack Table with server pagination, accessible column headers and an explicit empty state.
- Demo admission documentation reflects 202 queued responses and worker/progress semantics.
- `flagship-architecture-phases1-4.md` defines trust boundaries, current gaps, planned fixes and acceptance evidence through Phase 4 only.

## Verification and failure record

Frozen pnpm 9.15.4 install and Prisma generation pass locally. Local workspace tests pass: 357 (schemas 31, remediation 1, SDK 20, policy 54, web 41, scanner 45, API 165). Build, lint, strict types, docs and deterministic integration pass at this implementation checkpoint. Final publication CI is recorded in the PR; no result for an older commit substitutes for it.

Baseline CI run 38416478950 actually ran 346 workspace tests: 27+1+20+54+37+44+163, plus six browser tests. The prior handoff's 163 total was the API count, not lost suites.

The workspace Git proxy clone failed for missing authentication; direct GitHub clone recovered the exact Phase 1 checkout. Initial Prisma generation lacked the required local unpooled URL; the ignored development template restored it. Pinned pnpm shims avoid the ambient pnpm 11 runtime. Formatting was attempted before installation finished; it succeeded once installation linked the tools. New parameterized test rows needed object wrappers; React act callbacks needed asynchronous flushing. CLI regression exposed encoded-purl credential leakage and Date serialization; covered fixes retain validation and lint rules.

Actual PostgreSQL persisted-SBOM regression is added to the existing CI database script. Local Docker/PostgreSQL and browser execution are not claimed; CI must provide that evidence. Seed preservation/rollback/concurrency beyond existing tests remains pending, not established merely by the seed lock.

## Remaining gates

Phase 1 remains PARTIAL: production session create/read/close lifecycle and full coverage propagation remain outstanding. Existing ACTIVE/tenant/actor gateway checks remain enforced. Independent acceptance remains pending. Phases 2–4 still require accepted predecessor integration and their own fixes/live qualification; Phase 5 is not advanced.

## Completion update — 2026-10-15 (supersedes remaining implementation gaps above)

Recovered from published follow-up `3b062d263afd96f96158bb4982b84a47861383fa`
on `phase1/flagship-integrity-followup`, targeting the unchanged Phase 1 base
`phase1/consolidate-stabilize` (`f996445bde6cde57011461c45a1fd8eb007518ab`).
The subsequent local completion work described in the request was absent in this
machine; this completion was newly implemented after inspecting the published
branch. Earlier onboarding edits in `/workspace/Agentshield` remain untouched;
this work uses the separate ordinary checkout `/workspace/Agentshield-phase1`.
The requested `docs/industry-product-implementation-plan.md` is absent from this
published branch. No Phase 2–4 feature or branch was changed.

### Review finding → invariant → regression

| Current review finding           | Invariant / implementation                                                                                                                                                                           | Regression evidence                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 4272394287: PURL encoding        | Redact decoded components, retain structural/scoped-name encoding, reconstruct changed components; nested encodings are bounded and malformed inputs fail closed.                                    | `packages/schemas/src/evidenceRedaction.test.ts`: scoped names, encoded/nested versions, qualifiers, malformed encoding and safe URLs. |
| 4272394303: URL authority        | Userinfo stops at `/`, `?`, `#`; ordinary query/fragment email addresses keep their host. Encoded credential query keys are redacted.                                                                | Same suite: authority boundaries and query/fragment preservation.                                                                      |
| 4272394296: retry history        | Claim CAS includes attempt and retry bound. Successful claim and sanitized attributed prior-failure audit commit atomically before current fields are cleared. A losing claimant creates no history. | `pnpm test:phase1-completion`: actual PostgreSQL claim race, durable history after success and audit-injection rollback.               |
| 4272394313: dependency collision | Consolidate redacted public identity, retain conservative scope, link advisories to persisted IDs, count persisted rows; no secret-derived discriminator/hash.                                       | Same PostgreSQL regression: colliding raw versions, production scope, persisted count, advisory relation, absence of credentials.      |

The lifecycle contract now has authenticated tenant/actor-owned create/read/close
routes and SDK methods. Creation uses tenant/actor/key serialization, exact context
replay/conflict and atomic audit. Terminal replay never reopens a session. Session
closure shares transaction locking with event ingestion, authorization admission
and approval creation. Cross-owner responses avoid existence disclosure. Existing
admitted external work is not reversed; this remains a cooperative SDK contract.

Coverage now distinguishes enumerated/inspected/unsupported files and excluded
entries through walker, scanner, all four CLI formats, metadata/API, UI and canonical
receipts. Excluded directories never invent hidden-file counts. Historical coverage
is unavailable, not backfilled. Optional coverage changes new hashes/signatures;
absent fields preserve old verification. Unsigned canonical payload retention does
not make a signed receipt or prove safety. No reader private-key distribution change.

The additive migration `20261015120000_phase1_session_lifecycle` preserves existing
migration files/checksums and adds nullable idempotency/context columns and audit
enum values. The legacy upgrade test preserves populated scan, audit, receipt,
session and tenant relationships. Imported seed helpers do not execute the CLI.
Disposable-database tests prove seed rollback and concurrent serialization while
retaining customer-owned data, audits and receipts inside the demo tenant.

### Local commands and outcomes

Runtime: Node 24.19.0 (supported by `engines`), repository-pinned pnpm 9.15.4.
PostgreSQL: dedicated loopback Docker `postgres:16-alpine` instance; synthetic local
credentials only. Database scripts were run with `NODE_ENV=test`; the completion
regression additionally requires `AGENTSHIELD_DISPOSABLE_DATABASE=true`.

- `pnpm install --frozen-lockfile --store-dir /tmp/agentshield-pnpm-store`: PASS.
- `pnpm db:generate`, `pnpm db:validate`, `pnpm db:deploy`: PASS, including fresh deployment of all eight migrations.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:docs`: PASS.
- `pnpm test`: PASS, 375 workspace tests (schemas 40, remediation 1, SDK 22, policy 55, web 42, scanner 50, API 165).
- `pnpm test:integration`, `pnpm test:database-upgrade`, `pnpm test:lease-takeover`, `pnpm test:phase1-round2`, `pnpm test:phase1-completion`, `pnpm test:gateway`, `pnpm test:github-lifecycle`: PASS against disposable PostgreSQL where applicable. Gateway/GitHub regressions are synthetic, not live-provider qualification.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:e2e`: PASS, all six browser tests. Coverage UI has additional component regression tests.
- Compiled API HTTP smoke on local port 3301: PASS for readiness, authentication/RBAC, strict identity/query validation, create/replay/conflict, actor privacy, close and terminal replay.
- Source SARIF gate with the existing CI exclusions and `scripts/validate-sarif.ts`: PASS. Fixture BLOCK exit 3 and SARIF validation remain required publication CI gates.
- Local Docker image build: attempted twice. Docker config initially used an unwritable home; a disposable `DOCKER_CONFIG` fixed that. Build then failed fetching pnpm inside Corepack's runtime stage, including with predefined proxy build arguments. Verification stayed enabled. This is not a local container-build pass; final-head CI must qualify the unchanged container recipe.

### Failures investigated and fixed

Ambient pnpm was 11; a local pinned 9.15.4 install restored the repository toolchain.
An initial npm cache path was unwritable; the existing disposable cache corrected it.
The original retry regression caught removal of the claim's exhaustion predicate;
claim now checks both expected attempt and maximum-attempt bound. New code initially
failed strict type/lint/format checks; fixes preserve all rules. Source scanning
flagged a literal synthetic query credential in a new test; constructing its test
value removed the source finding without changing exclusions or assertions.
Injected PostgreSQL audit failures are expected regression outcomes proving rollback,
not ignored application failures.

### Publication and acceptance register

The published baseline and its earlier green CI do not qualify this completion.
Implementation commits and final published identity are recorded in PR #16's body
and Git history; the publication record below will be updated after CI completes.
Review findings have implementation/regression dispositions, not independent
acceptance. Existing review threads remain open pending review of the new head.
Live OIDC, GitHub App/webhook/provider behavior, deployment and independent security
acceptance are unverified here. Phase 1 acceptance remains PARTIAL until its
independent gate is satisfied; no dependent phase is advanced. Next permitted step:
review the final Phase 1 head and qualify its outstanding external gates.

### Published implementation checkpoint and final-head evidence

Implementation checkpoint: `80f09a4390514181b45247974b7673c227d8183a`,
tree `6aa7d8e8360124a34c8acd96a1c42e3704ec11dc`. GitHub's published tree
matched the tested local tree. Both exact-checkpoint CI runs passed, including
container generation/build, PostgreSQL upgrades/completion regressions, all
workspace tests, six browser tests and the fixture/source security gates:

- [Push CI 38732236358](https://github.com/sam300705/Agentshield/actions/runs/38732236358).
- [PR CI 38732241713](https://github.com/sam300705/Agentshield/actions/runs/38732241713).

The subsequent additive hardening rejects malformed PURLs with unencoded URL
structures before component splitting and preserves prior sanitized failure context
in cancellation audit metadata. Schema regressions and the real PostgreSQL
completion regression cover these cases. Final local verification is 375 workspace
tests plus the checks above; cancellation coverage additionally passed targeted
lint/types/PostgreSQL reruns. All eight existing migration files (including the
lock file) remain byte-identical to the published baseline. The local container
network limitation was qualified by successful GitHub CI, not by disabling trust.

The GitHub CLI PR editor failed on deprecated classic-project GraphQL fields;
the authorized PR title/body update succeeded using the REST endpoint without
changing its base or posting review messages. A new cancellation regression
initially missed its import, which was corrected before rerunning it successfully.

The final hardening/documentation commit must receive its own CI, independently of
the successful checkpoint above. Its exact published SHA/tree and final-head run
URLs are recorded in the [PR #16 publication record](https://github.com/sam300705/Agentshield/pull/16)
and [final-head checks](https://github.com/sam300705/Agentshield/pull/16/checks).
This committed handoff's own identity is available from Git history rather than a
self-referential SHA embedded in the file. No earlier passing run substitutes for
that final-head verification. Review threads remain unresolved for independent
review; out-of-date line positions are not acceptance. The next permitted task is
independent Phase 1 security review and controlled live-provider qualification.

## Review remediation and bounded product research — 2026-10-15

The subsequent read-only review verified published head
`d0247207641e5db8e2ab4f14a0036921aac594ec` and exact-head successful quality
runs 38732887743 (push) and 38732893632 (PR). It reproduced six additional
defects despite passing CI. This assistant authored earlier implementation;
the review was not independent human/organizational acceptance.

The newly authorized package repairs marker spoofing and nested query leakage,
PURL validation/npm scope construction, shutdown ABA failure-history loss, seed
writer/guard target mismatch, and YAML parse-completion coverage. The
[failure register](phase1-review-fix-register.md) records scenarios and regressions;
the [ADR](adr-phase1-integrity-boundaries.md) records reuse and compatibility.
No SQL or deployment configuration is changed. Existing migration files and
customer-record cleanup scope are preserved. No review thread is resolved.

Local checkpoint: 391 workspace tests, lint, strict types, build, frozen install,
format/docs checks, real disposable PostgreSQL completion (including forced ABA
and audit rollback), and populated upgrade/drift refusal PASS. Six browser tests,
integration, lease takeover, round-2 database, gateway and synthetic GitHub lifecycle
checks PASS. Source/fixture SARIF gates retain existing exclusions and expected
fixture BLOCK exit 3. Exact-head publication results belong in the PR record after
execution. PostgreSQL audit errors deliberately injected by the completion suite
are asserted rollback outcomes. Local container build was not repeated; the
unchanged recipe requires exact-head CI qualification.

[Product plan](industry-product-implementation-plan.md),
[proposed contracts/transitions](action-approval-execution-contracts.md),
[dated research protocol/ledger/comparator/pilot plan](product-research-ledger.md),
and [reuse decisions](reuse-decision-ledger.md) now exist. They distinguish code,
proposal and untested hypotheses. Detailed gateway documentation returned 403;
pinned source README evidence was inspected without treating it as executed
qualification. Actual customer feedback, repeated demand and willingness to pay
remain unverified; no outreach occurred.

Phase 1 remains PARTIAL pending final published-head checks and independent
acceptance. Phase 2 and dependent implementation remain BLOCKED; no stacked PR
is merged/retargeted. Live OIDC/GitHub, production key custody, restore/RPO/RTO,
performance/cost qualification and production deployment are not claimed.

Final YAML hardening retains structured Map keys during document conversion,
preventing the library from emitting raw repository keys in coercion warnings.
A dedicated regression checks the actual scanner's warning and result boundaries.
This additive change requires its own published-head CI, not the earlier candidate's.
