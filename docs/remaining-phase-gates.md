# Remaining gates before Phase 5

Snapshot from current GitHub PRs on 2026-10-08. All four PRs remain open/unmerged.
Passing CI is distinct from independent acceptance. Review threads can remain
unresolved after code changes, so each finding must be checked against current code
before treating it as a live defect. Preserve order #9 → #10 → #11 → #12.

| Phase / PR    | Current head before this follow-up       | Remaining gate                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 / #9  | 8d0032b35ff0fe2b5422fdecaf2a06482d462abd | Round 4 seven findings, final-head CI and independent acceptance                                                                                                                                                                   |
| Phase 2 / #10 | f22615be02296912d30d66536b7b3cd0468c714b | Review cancellation recovery, atomic seed preservation, sanitized approval resource contract and pagination tie-breaker; integrate accepted predecessor changes without history rewriting; fresh verification and acceptance       |
| Phase 3 / #11 | 49d2274c601a63b88aadcaa511526af1bb90946a | Revalidate Check updates/IDs/retries, pending publications, App permissions, successful-response parsing, tenth-page handling and repository snapshot ordering against current code; real controlled GitHub App lifecycle evidence |
| Phase 4 / #12 | 27a6473248c06c60ead7ab7cc576483dc7ff06b1 | Review shutdown leases, OIDC URL build validation, readiness observability, Redis fixture readiness, worker-only signing secrets and testing the actual deployment artifact; owner configuration and live evidence                 |
| Phase 5       | No implementation in this remediation    | Hold until required predecessor acceptance gates are complete                                                                                                                                                                      |

Existing CI is green on the four listed heads. No APPROVED review submission is
present in the inspected reviews. That evidence does not establish acceptance.
Phase 3/4 owner tasks include controlled App installation/credentials, public webhook
ingress, production OIDC endpoints, provider secrets, telemetry/alerts and isolated
backup recovery. Credentials must stay in approved secret stores, never in chat or
source. Do not provision or deploy based solely on this inventory. Detailed operator
procedures remain on their own phase branches.

## Round 5 follow-up

The eleven new Phase 1 findings on `39a922465beca2237796dee27f5f213fe44b42f3` are addressed in `phase1-round5-report.md`; published-head CI and independent acceptance remain distinct. The earlier table is a historical snapshot. Figma frame IDs are now available in `phase5-design-handoff.md`; no manual frame discovery is needed. This does not authorize advancing past predecessor gates.
