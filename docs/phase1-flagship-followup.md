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
