# Phase 1 Round 3 remediation — 2026-10-08

Overall status: **PASS** for implementation and applicable verification; independent security acceptance pending.

Scope: seven new findings on PR #9 at `5519054883438af71445c07003c819e8a0ad36fe`. Preserve all 21 Round 1 and 16 Round 2 corrections, tests, and migrations. Work remains on `phase1/consolidate-stabilize`, based on main; no changes to PR #10, #11, #12, main, or deployments. Phase 2 stays paused until independent acceptance.

| Finding                                            | Classification | Root cause / correction                                                                                                                                                                                                   | Files / regression                                                                                 |
| -------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Action evidence omitted from approval identity, P1 | VALID          | Shared versioned canonical action serialization includes sanitized evidence; API and Node SDK hash the same identity. Changed command evidence conflicts even after approval.                                             | schemas/agent-action-identity; agentApprovalService and SDK tests; actual PostgreSQL gateway suite |
| Approval session ownership, P1                     | VALID          | Check tenant and actor before fresh or replay reads, constrain replay relation, and recheck ownership inside creation transaction.                                                                                        | agentApprovalService/tests; actual PostgreSQL wrong-actor gateway check                            |
| OIDC refresh nonce, P2                             | VALID          | Require nonce at authorization-code exchange; signed refresh ID tokens may omit it. Retain signature, issuer, audience, expiry, and subject validation.                                                                   | oidc.ts/tests with real signed JWT/JWKS; session refresh without nonce                             |
| Populated pre-history database upgrade, P1         | VALID          | Preserve immutable migration SQL. Explicit guarded baseline identifies an exact migration prefix by catalog rehearsal, records only that prefix, then uses existing incremental deploy. Unknown drift/history is refused. | database-baseline, baseline-database, verify-database-upgrade, database-upgrades.md, CI            |
| Demo claims event-chain verification, P2           | VALID          | Label the display-hash fixture "Demo chain unverified"; do not substitute demo display hashes for verified integrity evidence.                                                                                            | App.tsx; browser replay assertion                                                                  |
| Receipt hash not recomputed, P2                    | VALID          | Recompute canonical receipt digest before signing and before signature acceptance. A trusted signature over a false internal digest is rejected.                                                                          | signedReceipt.ts/tests; key-rotation and existing receipt round-trips retained                     |
| SDK accepts remote plaintext HTTP, P1              | VALID          | Parse endpoint URLs; allow HTTP only for loopback development, otherwise HTTPS. Reject embedded credentials/query/hash and refuse redirects before token transport.                                                       | agent-sdk index/tests; endpoint and redirect contract tests                                        |

## Compatibility and rollback

The action identity is now versioned as `agent-action@2`. Old approval digests are intentionally not treated as authorization for the new evidence-bound request. Historical rows remain; clients need a fresh reviewed request/key when an old digest conflicts. No stored historical approval is rewritten. The Node SDK checks the complete digest before accepting a protected action.

OIDC login still requires the original nonce. Refresh may omit it while retaining verified identity. Invalid receipt hashes previously accepted by signing/verification are now rejected; valid canonical receipts remain compatible. The deployed demo is not relabeled as production.

Existing migration checksums are untouched. Empty and normally tracked databases use the existing deploy path. A real pre-history installation requires a backup, quiesced writes, and the explicit verified baseline maintenance step described in `database-upgrades.md` before deployment; this round performs no real deployment or database maintenance. Disposable PostgreSQL CI verifies preservation and drift refusal. Unknown legacy variants remain blocked pending inspected reconciliation, rather than silently baselined.

Rollback should retain these fail-closed boundaries. Use a forward reviewed correction for discovered schema incompatibilities; never reset data or rewrite applied migration SQL.

## Verification and handoff

Local environment: Node 24.19.0 with pinned pnpm 9.15.4; CI baseline Node 22 / PostgreSQL 16. Frozen install succeeded; committed lockfile unchanged.

| Exact check                                                          | Local outcome                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| pnpm install --frozen-lockfile                                       | PASS                                                                |
| pnpm db:generate; pnpm exec prisma validate                          | PASS                                                                |
| pnpm format:check; pnpm lint; pnpm typecheck                         | PASS                                                                |
| pnpm test                                                            | PASS — 207 tests, including earlier regressions                     |
| pnpm build; pnpm test:docs                                           | PASS                                                                |
| pnpm test:integration                                                | PASS — 15 findings / 6 dependency records                           |
| Fixture scanner / validate-sarif                                     | PASS — expected exit 3                                              |
| Source scanner / validate-sarif with existing CI exclusions          | PASS — exit 0 / zero findings                                       |
| pnpm test:e2e                                                        | PASS — all 6 Chromium headless-shell browser tests                  |
| git diff --check                                                     | PASS                                                                |
| pnpm test:database-upgrade                                           | BLOCKED locally — no PostgreSQL listener; no fake database result   |
| Compose/container, migrate/seed, gateway/lifecycle/Round 2 PG suites | BLOCKED locally — Docker/PostgreSQL unavailable; actual CI required |
| Live providers, baseline of a real deployed database, deployment     | NOT RUN — outside scope                                             |

The workflow adds the actual populated-upgrade check and retains all prior gates. CI evidence is required and reported separately from local infrastructure limits.

Remediation commit: `b23c1d1e6ec8da62b49aa3a20e34c159973b2de4`. Published and locally tested trees match: `66c08a27310aab494e266bbffb5ce8d5326277b6`. Publication was a normal expected-head fast-forward from the recorded starting commit.

Actual remediation CI [37686718211](https://github.com/sam300705/Agentshield/actions/runs/37686718211) completed successfully on Node 22 / PostgreSQL 16. Every workflow gate passed: fresh install/migrations/seed, Compose/container build, lint/types/tests/build, startup, populated legacy baseline plus incremental upgrade, Round 2 database suite, actor/evidence gateway regressions, webhook lifecycle, all 6 browser tests, and fixture/source SARIF validation. The populated upgrade retained its scan data and refused unknown drift.

The follow-up fixes canonical action ordering to code-point order independent of host locale, adds its regression (207 local tests total), and explicitly verifies the preserved row exists and migration history is read in the isolated upgrade schema. The initial remediation run had 206 unit tests. Final follow-up head/tree and its complete CI result are recorded in the PR handoff; the preceding run is not claimed as a test of this follow-up. Implementation and CI success must not be described as independent security acceptance. Stop before Phase 2; no merge, force push, rebase, retargeting, provisioning, or deployment.
