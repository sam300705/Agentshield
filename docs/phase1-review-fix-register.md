# Phase 1 review failure/fix and threat-to-regression register

Review baseline: PR #16 head `d0247207641e5db8e2ab4f14a0036921aac594ec`.
Date: 2026-10-15. This assistant also implemented earlier follow-up code;
neither the review nor the fixes constitute independent human/organizational acceptance.
Current publication identity/checks are in PR #16. Threads remain open.

## Reproduced failures and candidate fixes

| ID / severity | Prerequisites and failure at baseline                                                                                                                                                     | Candidate correction / regression                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 HIGH       | Untrusted evidence/dependency value contains `API_KEY=<private>[REDACTED:FORGED]`; shared evidenceRedaction.ts:94 trusted any marker substring and persisted/exported the private prefix. | Exact whole-placeholder exemption only. Schema fixtures include forged and canonical markers appended/prepended to private text; actual CLI JSON/JSONL/SARIF and scanner → PostgreSQL canaries.                                                                              |
| F2 HIGH       | Nested URL `?next=https://inner.test?%74oken=<private>` or short password; outer query match consumed the inner credential.                                                               | Bounded recursive value inspection plus decoded key classification; nested encoded PURL fixtures, real CLI and actual persistence. Existing safe query/fragment/authority regressions retained.                                                                              |
| F3 MEDIUM     | Worker A reads queued attempt 0; B claims then shuts down and restores queued attempt 0 with a failure; A claims from stale candidate and erases history.                                 | Row lock and actual-state reread, atomic archive/claim, due-time revalidation. Real PostgreSQL scheduling barrier forces this ABA; injected audit failure still rolls back. No provider HTTP in transaction.                                                                 |
| F4 MEDIUM     | Ambient URL passes seed guard but exported seed helper receives a PrismaClient for another destination.                                                                                   | Public helper accepts validated URL, constructs writer internally and disconnects. Forbidden database/schema rejection; import safety, real rollback, concurrency and customer-record preservation retained. Programmatic/configuration prerequisite, not an HTTP exploit.   |
| F5 MEDIUM     | Invalid/multidocument/templated YAML receives secret checks but structural check cannot parse; coverage nevertheless says COMPLETE and enters receipt.                                    | Optional incompleteChecks; parser errors/warnings/conversion failure/unrendered templates produce PARTIAL without source diagnostics. Real scanner, all CLI coverage formats, stored receipt/hash and UI assertions. No comprehensive YAML/Kubernetes correctness guarantee. |
| F6 MEDIUM     | Valid official npm PURL has `vcs_url=git:%2F%2F...`; blanket colon guard erases it. Surrounding preexisting emitter also encodes scope slash and labels pnpm/yarn as ecosystems.          | Pinned upstream parser; identity guard no longer rejects safe qualifier colons. Official example and scoped npm fixtures under all three installation tools. Preserve bounded component sanitization.                                                                        |

The original exact reproductions were observed in local export and disposable
PostgreSQL, not inferred solely from mocks. Newly added tests retain those execution
boundaries. Fixtures do not establish absence of every secret syntax or prompt attack.

## Original review threads

| Thread                         | Baseline disposition                                                      | Candidate evidence / independent status                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 4272394287 PURL decoding       | FIX VERIFIED for the original decode-whole case; F6 was a separate defect | Original scoped/encoded/nested fixtures retained and valid VCS qualifier added; independent current-head acceptance pending |
| 4272394303 authority regex     | FIX VERIFIED for original authority delimiter case; F2 was separate       | Safe query email/fragment and userinfo boundaries retained; nested query canaries added; acceptance pending                 |
| 4272394296 failure history     | STILL PRESENT through shutdown ABA                                        | Locked actual-state archive and deterministic real DB ABA now pass locally; acceptance pending                              |
| 4272394313 redaction collision | FIX VERIFIED for original collision case                                  | Actual consolidated PROD row, advisory foreign key and persisted count checks retained; acceptance pending                  |

Outdated GitHub line positions are not resolutions. No thread is resolved by this work.

## Threat-to-regression matrix

| Threat / attacker capability                              | Boundary and present evidence                                                                                            | Remaining limitation/gate                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Tenant escape / authenticated foreign tenant              | Existing owned controllers and actual PostgreSQL lifecycle tests reject foreign actor/tenant session reads and mutations | Full later-phase resource ownership integration pending                                                      |
| Actor impersonation / forged request fields               | Strict shared contracts and server identity; HTTP and controller regressions                                             | Live OIDC issuer/provider behavior unverified                                                                |
| Reviewer independence bypass / requester reviews          | Existing service checks and gateway regressions                                                                          | Exact action-bound approval authority requires Phase 2                                                       |
| Approval replay or stale commit/evidence/policy           | Proposed digest/admission contract                                                                                       | NOT IMPLEMENTED by this package; Phase 2 race/rollback gates                                                 |
| Direct credential bypass / agent owns provider credential | Cooperative SDK limitation documented                                                                                    | No enforced provider adapter yet; do not claim isolation                                                     |
| Duplicate external effect / timeout after success         | Proposed UNKNOWN/reconciliation/fencing contract                                                                         | Live provider execution NOT RUN; no exactly-once claim                                                       |
| Worker crash/stale state / overlapping workers            | Existing lease tests; real ABA and archive rollback regression                                                           | Scan claim evidence does not qualify later provider finalization                                             |
| Receipt tampering / altered coverage                      | Existing canonical hash/signature tests, stored unsigned coverage receipt verification                                   | Trusted keys/custody and privileged DB remain residual trust                                                 |
| Secret leakage / repository controls evidence             | Real CLI export and PostgreSQL dependency canaries; bounded nested decoding                                              | Pattern-based sanitization is not universal secret detection; historical exports need separate investigation |
| Migration/restore inconsistency / populated database      | Existing populated baseline/incremental upgrade and drift-refusal regression; no SQL changed                             | Real backup restoration/RPO/RTO belong to Phase 4                                                            |
| Resource exhaustion / hostile repository                  | Existing file/byte/deadline/symlink tests and bounded redaction nesting                                                  | Operating workload, fairness and memory limits not measured here                                             |
| Seed overwrite / mismatched caller configuration          | Writer constructed from validated target; rollback/concurrency/customer fixture preservation                             | Authorized isolated local seeding only; not a production recovery mechanism                                  |
| False completeness / malformed evidence                   | Partial YAML diagnostics propagated into canonical receipt and console                                                   | Heuristic static checks and secret regex remain explicitly limited                                           |

## Failures encountered while fixing

Pinned pnpm initially tried an unavailable home data directory; explicit disposable
XDG data/store paths restored the repository toolchain. No verification disabled.
The first parser regression exposed that YAML accepts Helm braces without a syntax
error; template detection now explicitly reports partial coverage. The PURL library
accepts some raw URL structures, so AgentShield retains its stricter raw-URL guard.
An upstream annotated-tag object produced a raw-source 404; fetching its commit
resolved the source review. These are recorded causes, not ignored failed checks.

Local verification: 390 workspace tests; strict types, lint, build, frozen install,
format/docs checks, real PostgreSQL completion and populated upgrade checks PASS.
All six browser tests, integration, lease takeover, round-2 database, gateway and
synthetic GitHub lifecycle checks PASS. Source SARIF gate and fixture BLOCK exit 3
plus SARIF validation PASS with unchanged exclusions. Published-head results belong
in the PR publication record after execution.
No live-provider, independent acceptance or production deployment claim follows.
