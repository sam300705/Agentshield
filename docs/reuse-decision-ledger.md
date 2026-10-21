# Reuse decision ledger

2026-10-15. Only the pinned PURL integration is newly adopted in this work package.
Unperformed evaluations remain pending; marketing statements are not security evidence.
Source references R1–R11 are in the [research ledger](product-research-ledger.md).

| Subsystem                   | Decision / exact version evidence                                                     | Security, burden, compatibility and cost disposition                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PURL parsing                | INTEGRATE packageurl-js 2.0.1, MIT; source cd1eb4b0; installed license inspected      | No runtime dependencies; lockfile integrity retained; local adversarial fixtures. No new service or storage. Performance not benchmarked; bounded decoding retained. Revert additive dependency/code together.                                        |
| API/UI/storage/contracts    | EXTEND current Express/React/Vite/TanStack/Prisma/PostgreSQL/Zod, current lockfile    | Preserve existing licenses and pins; no migration/replatform cost justified. Existing production privilege separation remains unqualified.                                                                                                            |
| OIDC/JWT                    | RETAIN existing jose integration                                                      | No custom JWT cryptography. Real issuer/JWKS/role claim behavior remains a live qualification item; no credential change.                                                                                                                             |
| Provider SDK                | INVESTIGATE mature SDK against existing client before Phase 3                         | Must handle provider ID precision, installation authority, scoped token refresh, conditional semantics and unknown outcomes. Version/license/transitives/runtime cost not yet qualified; none installed here.                                         |
| Secret/code scanning        | INTEGRATE candidate adapters; DEFER implementation                                    | R8/R9 show existing scanners. Check pinned versions, core vs hosted licenses, redaction, maintenance, transitive tools, CPU/scratch bounds, false positives and total hosted/operating costs first. Gitleaks maintenance notice is contrary evidence. |
| Policy                      | EXTEND deterministic TypeScript rules; DEFER OPA v1.21.2 / Cedar CLI v4.13.0 adoption | Official docs and release metadata inspected, not benchmarked. Evaluate schema/type tooling, revision replay, licenses, SDK versions, deployment and migration cost only if current rule complexity warrants it.                                      |
| Receipts / interoperability | EXTEND current canonical Ed25519; INVESTIGATE Sigstore v3.1.3, in-toto, SARIF/SBOM    | Existing SARIF stays. No new receipt format, trust root, transparency service or copied code. Retention/privacy, license/version/transitives and offline verification cost remain unqualified for new adapters.                                       |
| Cryptography                | ADOPT existing Node crypto; no replacement                                            | Retain configured Ed25519 validation and unsigned state. Operational key rotation/trust roots and live signing custody remain unverified.                                                                                                             |
| Telemetry                   | INVESTIGATE OpenTelemetry integration when Phase 4 enters                             | Do not invent telemetry now. Require redaction, bounded cardinality, tenant-safe export, retention and measured ingestion cost. Version/vendor choice pending.                                                                                        |
| Durable coordination        | EXTEND PostgreSQL claims/leases; DEFER new orchestration service                      | Actual claim ABA is repaired with a row lock. No demonstrated need for another broker. Later HTTP work requires fencing and reconciliation, not long transactions. Measure fairness, load and recovery before replacement.                            |

Before changing any pending decision, record exact version, license/attribution,
maintenance/security posture, transitive dependencies, deployment and performance
cost, lock-in, upgrade/rollback path and total operating cost. No blanket security
approval is conferred by inclusion in this table.

## Phase 3 provider reuse checkpoint, 2026-10-17

EXTEND the existing fetch/JWT adapter for this bounded delivery correction; no new
dependency or copied code. Investigated `@octokit/app` release v16.1.4 (2026-08-02),
its tag-pinned package/README/LICENSE using the official GitHub API. MIT; Node >=20;
direct dependencies include auth-app ^8.3.0, core ^7.0.7, webhooks ^14.0.0, paginate-rest
^15.0.0 and OAuth helpers. It is a mature App/auth/pagination integration candidate,
but adopting it does not supply database fencing or remote create idempotency.
Avoid replacing the tested transport during this correction. No installed license,
full transitive audit, runtime benchmark, maintenance guarantee or operating-cost
claim is inferred from release metadata. A later replacement needs compatibility,
retry/cancellation, ID precision, provenance and rollback qualification first.

Exact lookups: `repos/octokit/app.js/releases/latest`;
`repos/octokit/app.js/contents/{package.json,README.md,LICENSE}?ref=v16.1.4`.
Source: https://github.com/octokit/app.js/releases/tag/v16.1.4 .
GitHub token docs explicitly describe repository_ids and permission restriction;
local unit and real HTTP simulator checks verify our request shape, not GitHub's
live enforcement. No external integration or product-demand claim follows.
