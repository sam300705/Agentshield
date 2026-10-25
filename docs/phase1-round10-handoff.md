# Phase 1 Round 10 — Foundation Remediation, A0 Reclassification, and Handoff

Date: 2026-10-13. Branch: `phase1/consolidate-stabilize` (PR #9).  
Preserve the open stack: **#9 Foundation → #10 Backend → #11 GitHub → #12 Runtime**.  
No PRs were merged, retargeted, rebased or force-pushed. No production credentials modified. No live services deployed.

---

## 1. Executive Summary & A0 Finding Reclassification

The preliminary Phase A0 audit inspected `phase4/production-readiness` (commit `27a64732`), which had diverged from `phase1/consolidate-stabilize` at commit `2a993b9` prior to Phase 1 Rounds 2–9 (149 commits). Consequently, several findings reported in Phase A0 were either already resolved in Phase 1 or pertained strictly to downstream phases (#10, #11, #12).

Every finding was inspected against Phase 1 HEAD commit `62f69480d6d3` and classified:

| Finding ID      | Title & Summary                                        | Inspected Commit | Phase 1 Status                         | Evidence & Resolution                                                                                                                                                                                                                                           |
| :-------------- | :----------------------------------------------------- | :--------------- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FINDING-A0-01` | Untrusted repo ignore bypass in `scanRunner.ts`        | `62f69480`       | **ALREADY FIXED & ENHANCED**           | Fixed in commit `857406c`. `runScan` uses `options.ignorePatterns ?? []` without loading checkout `.agentshieldrc.json` or `.agentshieldignore`. In Round 10, enhanced with accurate `scannedFiles` and `skippedFiles` reporting and proven matching semantics. |
| `FINDING-A0-02` | Publisher DB locks held across external GitHub calls   | `62f69480`       | **DOWNSTREAM-ONLY (Phase 3 PR #11)**   | `githubCheckPublisher.ts` is introduced in PR #11. Does not exist in Phase 1.                                                                                                                                                                                   |
| `FINDING-A0-03` | Private signing keys in public API container env       | `62f69480`       | **DOWNSTREAM-ONLY (Phase 4 PR #12)**   | `render.yaml` runtime env groups belong to Phase 4 production deployment.                                                                                                                                                                                       |
| `FINDING-A0-04` | PR Stack divergence (#9 vs #10 merge conflict)         | `62f69480`       | **DOWNSTREAM-ONLY (Phase 2 PR #10)**   | PR #10 rebase/reconciliation belongs to Phase 2 after Phase 1 independent acceptance.                                                                                                                                                                           |
| `FINDING-A0-05` | Action-digest matching vs sanitized resource           | `62f69480`       | **ALREADY FIXED IN PHASE 1**           | Fixed in Round 9 (`13a9bd9`/`ead152c`). SDK `assertAgentApprovalMatches` validates `approval.actionDigest` rather than comparing display resource strings.                                                                                                      |
| `FINDING-A0-06` | Scan job cancellation overwritten by stale recovery    | `62f69480`       | **ALREADY FIXED IN PHASE 1**           | Fixed in Round 7/8. `recoverAbandonedJobs` acquires `SELECT FOR UPDATE`, re-reads fresh row state, and preserves cancellation.                                                                                                                                  |
| `FINDING-A0-07` | Finalized agent sessions accepting events              | `62f69480`       | **ALREADY FIXED IN PHASE 1**           | Fixed in Round 6/7. `ingestAgentEvent` validates `status: "ACTIVE"` both pre-check and inside advisory-locked transaction.                                                                                                                                      |
| `FINDING-A0-08` | Policy gateway decisions missing audit trail           | `62f69480`       | **ALREADY FIXED IN PHASE 1**           | Fixed in Round 9. `authorizeAgentActionController` persists `AuditEvent` with `action: AuditAction.POLICY_DECIDED` for all rule outcomes.                                                                                                                       |
| `FINDING-A0-09` | GitHub Check run update payload contains `headSha`     | `62f69480`       | **DOWNSTREAM-ONLY (Phase 3 PR #11)**   | Check publisher is part of Phase 3.                                                                                                                                                                                                                             |
| `FINDING-A0-10` | 64-bit integer precision loss for `checkRunId`         | `62f69480`       | **DOWNSTREAM-ONLY (Phase 3 PR #11)**   | Check Run ID typing belongs to Phase 3.                                                                                                                                                                                                                         |
| `FINDING-A0-11` | JSON parse / body read error marked non-retryable      | `62f69480`       | **DOWNSTREAM-ONLY (Phase 3 PR #11)**   | `GitHubApiError` retryable flag was introduced on Phase 3 branch.                                                                                                                                                                                               |
| `FINDING-A0-12` | Off-by-one / page limit error at exactly 1,000 repos   | `62f69480`       | **CURRENT DEFECT (FIXED IN ROUND 10)** | In `githubApiClient.ts`, verified completeness via `total_count`. If `repositories.length >= data.total_count`, complete list is returned without throwing; if incomplete at page 10, throws `GITHUB_REPOSITORY_LIMIT_EXCEEDED`.                                |
| `FINDING-A0-13` | Busy spinning on unchanged publication state           | `62f69480`       | **DOWNSTREAM-ONLY (Phase 3 PR #11)**   | Publication queue loop belongs to Phase 3.                                                                                                                                                                                                                      |
| `FINDING-A0-14` | Worker shutdown timeout (110s) vs scan lease (300s)    | `62f69480`       | **DOWNSTREAM-ONLY (Phase 4 PR #12)**   | 110s hard kill was introduced in Phase 4. Phase 1 worker drains gracefully via `shutdownController`.                                                                                                                                                            |
| `FINDING-A0-15` | Readiness probe mounted before metric middleware       | `62f69480`       | **DOWNSTREAM-ONLY (Phase 4 PR #12)**   | `observeRequest` Prometheus metrics belong to Phase 4.                                                                                                                                                                                                          |
| `FINDING-A0-16` | Database seeding non-atomic race                       | `62f69480`       | **CURRENT DEFECT (FIXED IN ROUND 10)** | Wrapped `prisma/seed.ts` inside atomic `prisma.$transaction` with advisory locking (`pg_advisory_xact_lock`) and updated `clearSeedScans` to execute on the transaction client.                                                                                 |
| `FINDING-A0-17` | Non-deterministic pagination tie-breakers              | `62f69480`       | **CURRENT DEFECT (FIXED IN ROUND 10)** | Added unique `id` tie-breakers across `scanController.ts` and `auditController.ts` order-by clauses for deterministic pagination.                                                                                                                               |
| `FINDING-A0-18` | Short commit SHA regex in `createRepositoryScanSchema` | `62f69480`       | **CURRENT DEFECT (FIXED IN ROUND 10)** | Updated `createRepositoryScanSchema.commitSha` to `fullGitHubCommitSchema.optional()`, enforcing 40-character hex SHAs at ingress.                                                                                                                              |

---

## 2. Round 10 Source Changes

1. **Trusted Scanner Configuration & Accurate Coverage Reporting (`packages/scanner`)**:
   - `packages/scanner/src/repoWalker.ts`:
     - Added `onIgnored?: (entryPath: string) => void` to `WalkRepositoryOptions`.
     - Normalized pattern trailing slashes in `isIgnored`: prefix patterns like `"test-dir/"` accurately match `"test-dir"` without traversing into excluded directories.
   - `packages/scanner/src/scanRunner.ts`:
     - `ScanRunnerResult` now records `scannedFiles: string[]` and `skippedFiles: string[]`.
     - Untrusted checkout configurations (`.agentshieldrc.json`, `.agentshieldignore`, `.agentshield.yml`) remain ignored by security gate evaluation; only caller-supplied exclusions are applied and transparently reported in `skippedFiles`.
   - `packages/scanner/src/scanRunner.test.ts`:
     - Proved ignore matching semantics under exact directory prefix vs wildcard globbing: wildcards like `"*"` do not match subpaths under prefix equality matching, while explicit directory exclusions are honored and recorded in `skippedFiles`.

2. **Commit SHA Validation Alignment (`packages/schemas`)**:
   - `packages/schemas/src/scan-job.schema.ts`:
     - Updated `createRepositoryScanSchema.commitSha` to use `fullGitHubCommitSchema.optional()`, failing closed on short SHAs (`abcdef1`), deleted-ref SHAs (`0000...`), and non-hex strings.
   - `packages/schemas/src/scan-job.schema.test.ts`:
     - Added test suite for `createRepositoryScanSchema` verifying rejection of short and malformed SHAs and acceptance of canonical 40-character commit SHAs.

3. **Pagination Limit Completeness Verification (`apps/api`)**:
   - `apps/api/src/integrations/githubApiClient.ts`:
     - In `listInstallationRepositories`, completeness is checked against `data.total_count`: when `repositories.length >= data.total_count`, exactly 1,000 repositories on page 10 are accepted as complete. If incomplete when reaching `MAX_REPOSITORY_PAGES`, it throws `GITHUB_REPOSITORY_LIMIT_EXCEEDED` rather than silently truncating.
   - `apps/api/src/integrations/githubApiClient.test.ts`:
     - Added unit tests for verified complete synchronization at the 1,000-repository boundary and fail-closed rejection on incomplete datasets.

4. **Deterministic Unique Tie-Breakers (`apps/api`)**:
   - `apps/api/src/controllers/scanController.ts` & `apps/api/src/controllers/auditController.ts`:
     - Added secondary `{ id: "asc" }` / `{ id: "desc" }` order criteria to `listRepositoriesController`, `listScansController`, `getScanFindingsController`, `getScanSbomController`, and `listAuditEventsController`.

5. **Atomic Database Seeding (`prisma`)**:
   - `prisma/seed.ts`:
     - Wrapped seed clearing and creation inside an atomic `prisma.$transaction` with a PostgreSQL transaction-scoped advisory lock (`pg_advisory_xact_lock(hashtext('agentshield-seed'))`).
   - `apps/api/src/services/seedCleanup.ts`:
     - Updated `clearSeedScans` to support `Prisma.TransactionClient` in addition to `PrismaClient`.

---

## 3. Verification & Regressions

- `pnpm format:check`: 100% PASS (Prettier code style validated).
- `pnpm lint`: 100% PASS (Zero ESLint warnings or errors).
- `pnpm typecheck`: 100% PASS (TypeScript compiler project references validated).
- `pnpm test:docs`: 100% PASS (Capabilities and documentation consistency confirmed).
- `pnpm test`: 100% PASS (All 163 unit and integration tests passed across all 8 workspace packages).
- `prisma validate`: 100% PASS (Prisma schema valid).

---

## 4. Operational Boundaries & Stack Status

- Open Stack sequence strictly preserved: **#9 → #10 → #11 → #12**.
- No git rebase, force-push, or retargeting performed.
- Code completion is reported separately from independent security acceptance.
