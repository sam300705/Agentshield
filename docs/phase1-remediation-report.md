# Phase 1 remediation verification — 2026-10-07

Overall status: **PASS**. All 21 current PR #9 inline review findings were VALID at starting head and received scoped corrections. All applicable checks passed locally or in actual GitHub CI on remediation commit `177cfd8ea25aaac7b34e1aa81ed21903e01ec7dc`. Local PostgreSQL/Docker limits remain recorded separately. This is readiness for another security review; no merge or production-readiness claim is made.

## Git and review evidence

- Repository: sam300705/Agentshield.
- Branch: phase1/consolidate-stabilize.
- Starting SHA: 2a993b9a0bd8299d178ce2fc1c86803cef09acc4, verified by fetch and GitHub PR metadata.
- PR #9: open, unmerged. Starting-head CI run 37484570483 was successful; it does not verify this remediation.
- Review source: all 21 current unresolved inline threads returned by GitHub on this turn (9 P1, 12 P2).
- Remediation commit: `177cfd8ea25aaac7b34e1aa81ed21903e01ec7dc`. Terminal Git push lacked credentials; connected GitHub publication succeeded with a normal fast-forward and expected-head check. Remote and locally tested trees matched exactly (`5da073c133effe2c73dfd39b55176a8717ba7f8b`).
- Full remediation CI: [run 37620483883](https://github.com/sam300705/Agentshield/actions/runs/37620483883), completed successfully. This follow-up documentation commit records those results; final branch SHA is in the delivery report.
- No main implementation base, merges, rebases, force pushes or direct downstream-branch edits.

## Findings

All rows are **VALID**; no current finding was silently ignored or deferred.

| Priority | Finding                       | Changed files                                                                                                                                   | Correction                                                                                                                                                                                        | Regression                                               | Verification                                    |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| P1       | Active jobs during shutdown   | apps/api/src/services/scanQueue.ts                                                                                                              | Release shutdown-aborted jobs without consuming retry attempts; retain completed scans and fence worker writes.                                                                                   | scanQueue.regression.test.ts                             | PASS                                            |
| P1       | Underscore GitHub tokens      | packages/policy-engine/src/controlPlane.ts                                                                                                      | Redact ghp/gho/ghu/ghs/ghr and github_pat underscore tokens before evidence persistence and integrity hashing.                                                                                    | controlPlane.test.ts                                     | PASS                                            |
| P1       | Seed target validation        | prisma/seed.ts; apps/api/src/services/seedSafety.ts                                                                                             | Parse PostgreSQL URLs; allow exact loopback hosts and agentshield/public target only; reject host overrides, malformed URLs and production.                                                       | phase1Safety.test.ts                                     | PASS                                            |
| P1       | Dead-lettered jobs selected   | apps/api/src/services/scanQueue.ts                                                                                                              | Require no dead-letter timestamp and attempts below maxAttempts at both selection and conditional claim.                                                                                          | scanQueue.regression.test.ts                             | PASS                                            |
| P1       | Blank signing settings        | apps/api/src/services/scanService.ts                                                                                                            | Trim blanks to unset; reject partially configured signing; existing signer continues rejecting invalid keys.                                                                                      | phase1Safety.test.ts; signedReceipt.test.ts              | PASS                                            |
| P1       | Claimed webhook recovery      | apps/api/src/controllers/githubWebhookController.ts; apps/api/src/integrations/githubDeliveryStore.ts; scripts/verify-github-lifecycle.ts       | Reclaim failed/expired identical deliveries with conditional attempt fencing; catch internal lifecycle failures; retain terminal dedupe and enqueue idempotency.                                  | githubDeliveryStore.test.ts; PostgreSQL lifecycle script | PASS unit and PostgreSQL CI                     |
| P1       | Organization platform risk    | apps/api/src/controllers/dashboardController.ts; apps/web-dashboard/src/lib/api.ts; apps/web-dashboard/src/components/LiveDashboard.tsx         | Aggregate risk across authenticated organization; preserve latest-scan severity and decision counts. Historical findings remain conservatively counted because no resolution model is introduced. | controllers/phase1.regression.test.ts                    | PASS                                            |
| P1       | Prisma URL in container build | Dockerfile; .github/workflows/ci.yml                                                                                                            | Supply non-secret command-scoped generation URLs; add actual container build to CI.                                                                                                               | CI docker build gate                                     | PASS actual Docker build in CI; BLOCKED locally |
| P1       | Policy/receipt lineage        | apps/api/src/services/scanService.ts; apps/api/src/services/scanQueue.ts; apps/api/src/services/scanJobExecutor.ts; packages/scanner/src/cli.ts | Reject unsupported bundles before evaluation/persistence and demo-executor bypass; label demo jobs/scans with built-in 2026.06.0.                                                                 | phase1Safety.test.ts                                     | PASS                                            |
| P2       | Lease recovery renewal race   | apps/api/src/services/scanQueue.ts                                                                                                              | Recheck stale lease inside transaction; update scan only for the job actually recovered.                                                                                                          | scanQueue.regression.test.ts                             | PASS                                            |
| P2       | Repository pagination         | apps/api/src/controllers/scanController.ts                                                                                                      | Parse shared pagination, bound skip/take and return tenant-scoped totals.                                                                                                                         | controllers/phase1.regression.test.ts                    | PASS                                            |
| P2       | Seed receipt FK failure       | prisma/seed.ts; apps/api/src/services/seedCleanup.ts                                                                                            | Delete restrictive receipts and scan-linked simulations before scans inside one transaction.                                                                                                      | seedCleanup.test.ts                                      | PASS unit and PostgreSQL CI                     |
| P2       | Cross-tenant metrics          | apps/api/src/controllers/systemController.ts                                                                                                    | Scope every queue count through authenticated scan.organizationId.                                                                                                                                | controllers/phase1.regression.test.ts                    | PASS                                            |
| P2       | Repository idempotency race   | apps/api/src/services/scanQueue.ts                                                                                                              | Catch Prisma P2002 after rolled-back transaction and return organization-scoped winner.                                                                                                           | scanQueue.regression.test.ts                             | PASS unit and PostgreSQL CI                     |
| P2       | Disconnected highestRiskPath  | packages/policy-engine/src/controlPlane.ts                                                                                                      | Retain all observed predecessor nodes through the last high-risk event; preserve graph confidence labels.                                                                                         | controlPlane.test.ts                                     | PASS                                            |
| P2       | Advisory certainty loss       | apps/api/src/services/scanService.ts                                                                                                            | Persist/count confirmed advisories only; retain uncertain inventory match/reason diagnostics in scan metadata.                                                                                    | phase1Safety.test.ts                                     | PASS                                            |
| P2       | Non-rotating refresh token    | apps/web-dashboard/src/lib/oidc.ts                                                                                                              | Retain old refresh token when a successful refresh response omits replacement.                                                                                                                    | oidc.test.ts                                             | PASS                                            |
| P2       | Receipt path validation       | apps/api/src/controllers/agentGatewayController.ts                                                                                              | Apply bounded Zod scan-ID contract before Prisma lookup.                                                                                                                                          | controllers/phase1.regression.test.ts                    | PASS                                            |
| P2       | Live approvals not actionable | apps/web-dashboard/src/components/LiveDashboard.tsx; apps/web-dashboard/src/main.tsx                                                            | Link to existing approval review and finding/scan pages within authenticated live routes.                                                                                                         | LiveDashboard.test.tsx                                   | PASS component                                  |
| P2       | Invalid scanner limits        | packages/scanner/src/cli.ts; packages/scanner/src/limits.ts                                                                                     | Reject nonpositive/nonfinite/noninteger unsafe limits and timer overflow before traversal.                                                                                                        | limits.test.ts                                           | PASS                                            |
| P2       | Rate-limiter bucket cap       | apps/api/src/security/rateLimit.ts                                                                                                              | Reject new identities at 10000 active buckets after expiration cleanup; preserve existing identity limits.                                                                                        | rateLimit.test.ts                                        | PASS                                            |

Test paths are relative to their package's src directory. API test paths are under apps/api/src; policy tests under packages/policy-engine/src; OIDC/component tests under apps/web-dashboard/src; scanner limit tests under packages/scanner/src. Existing tests and assertions were retained.

## Verification

| Command                                                                 | Result  | Evidence / limits                                                                                      |
| ----------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| corepack enable                                                         | BLOCKED | Default global shim directory is protected.                                                            |
| corepack enable --install-directory /workspace/scratch/02a93edd4282/bin | PASS    | Writable local shim; pnpm 9.15.4.                                                                      |
| pnpm install --frozen-lockfile                                          | PASS    | All 547 packages installed; committed lockfile retained.                                               |
| pnpm db:generate                                                        | PASS    | Prisma Client 6.19.3 generated with dummy local URLs.                                                  |
| pnpm db:validate                                                        | PASS    | Added missing alias to existing prisma validate command; schema valid.                                 |
| pnpm exec prisma validate                                               | PASS    | Repository's pre-existing CI command.                                                                  |
| pnpm format:check                                                       | PASS    | Final formatted sources.                                                                               |
| pnpm lint                                                               | PASS    | Strict linting unchanged.                                                                              |
| pnpm typecheck                                                          | PASS    | Strict TypeScript unchanged.                                                                           |
| pnpm test                                                               | PASS    | 154 tests, including API, scanner, policy, signing, OIDC and live-approval component regressions.      |
| pnpm build                                                              | PASS    | All workspace builds.                                                                                  |
| pnpm test:docs                                                          | PASS    | Capability/documentation consistency.                                                                  |
| pnpm test:integration                                                   | PASS    | 15 deterministic findings, 6 dependency records; scanner-policy-remediation integration.               |
| pnpm test:gateway                                                       | BLOCKED | No runnable PostgreSQL server; localhost connection failed.                                            |
| pnpm test:github-lifecycle                                              | BLOCKED | No runnable PostgreSQL server. New exclusive-retry/fencing integration assertions passed in actual CI. |
| pnpm db:deploy                                                          | BLOCKED | No runnable PostgreSQL server.                                                                         |
| pnpm db:seed                                                            | BLOCKED | No runnable PostgreSQL server.                                                                         |
| pnpm test:e2e                                                           | PASS    | All 6 real Playwright browser tests after installing Chromium.                                         |
| Fixture scanner plus validate-sarif.ts                                  | PASS    | 15 findings, expected BLOCK gate; valid SARIF.                                                         |
| Source scanner plus validate-sarif.ts                                   | PASS    | CI-equivalent exclusions; 0 source findings; valid SARIF.                                              |
| docker build --tag agentshield:phase1 .                                 | BLOCKED | Docker executable unavailable; actual build added to CI.                                               |
| pnpm db:up                                                              | BLOCKED | Docker executable unavailable.                                                                         |
| pnpm db:down                                                            | BLOCKED | Docker executable unavailable.                                                                         |
| git diff --check                                                        | PASS    | No whitespace errors.                                                                                  |
| Live external GitHub/OIDC/OSV/key deployment                            | NOT RUN | Existing optional activation; not Phase 1 scope.                                                       |

Early lint/build/test issues in new test scaffolding were corrected without weakening assertions. Browser installation recovered through the download fallback. PostgreSQL runtime binaries were restored from a package archive, but the sandbox refuses chown and runuser group changes; PostgreSQL cannot run under this root-only execution identity. No substitute database was counted as PostgreSQL verification. Local Node is v24.19.0; repository CI remains pinned to Node 22.

## Actual GitHub CI results

All results below are for remediation commit `177cfd8`, on Node 22, in completed run 37620483883. They do not overwrite the local BLOCKED statuses above.

| CI command/check                                             | Result                      |
| ------------------------------------------------------------ | --------------------------- |
| pnpm install --frozen-lockfile                               | PASS                        |
| docker compose config; pnpm db:up; pnpm db:down              | PASS for each command       |
| docker build --tag agentshield:phase1 .                      | PASS                        |
| pnpm db:generate                                             | PASS                        |
| pnpm exec prisma validate                                    | PASS                        |
| pnpm db:deploy                                               | PASS                        |
| pnpm db:seed                                                 | PASS                        |
| pnpm format:check                                            | PASS                        |
| pnpm lint                                                    | PASS                        |
| pnpm typecheck                                               | PASS                        |
| pnpm test                                                    | PASS                        |
| pnpm test:docs                                               | PASS                        |
| pnpm build                                                   | PASS                        |
| pnpm dev; readiness; dashboard HTTP; WORKER_MODE=once worker | PASS for each startup check |
| pnpm test:integration                                        | PASS                        |
| pnpm test:gateway                                            | PASS                        |
| pnpm test:github-lifecycle                                   | PASS                        |
| Playwright installation                                      | PASS                        |
| pnpm test:e2e                                                | PASS                        |
| Fixture scanner expected exit 3                              | PASS                        |
| Fixture SARIF validation                                     | PASS                        |
| Source scanner expected exit 0                               | PASS                        |
| Source SARIF validation                                      | PASS                        |
| SARIF artifact upload                                        | PASS                        |
| GitHub security SARIF upload                                 | PASS                        |

Built API `/health/live` also returned 200 locally in documented demo-auth configuration. The original policy source was temporarily tested against the new regressions: seven tests failed on the starting implementation, and all 15 passed after restoring the correction. No original published commit was rewritten.

## Remaining blockers

- Code: no known unresolved reviewed finding after regression checks. Actual PostgreSQL and container CI gates passed; unit mocks were not counted as substitutes.
- Environment: local Docker absent; local PostgreSQL cannot start under the available identity.
- Owner/manual configuration: none needed for local Phase 1 fixes. No live identity/provider/key activation claimed.

## Phase decision

PR #9 is ready for another Codex/security review of the corrective code. Full remediation CI, including PostgreSQL, Docker, startup, browsers and security gates, passed. Reviewer acceptance remains necessary before any separately authorized merge; CI alone does not settle review findings. Stop here; no Phase 2 remediation or merging.
