# Phase 2 current review and failure register

Candidate reviewed: normal integration merge `1c7687ac8679438fe1fd12f85dff6b2357316ae7`,
PR #17. Both exact-head CI quality runs passed (38951926070, 38951962499), then Codex
reported three concrete regressions. Green CI did not qualify these boundaries.
No original review thread is resolved by the implementation assistant.

| Review finding                     | Scenario / prerequisites                                                                                                                                      | Correction                                                                                                                                                                                            | Regression evidence                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4298392080, high correctness       | A populated Phase 2 parent database has a queued supported LOCAL/local-demo payload with policyBundleVersion=demo. New executor rejects it and burns retries. | Recognize the exact legacy marker only for the fixed local demo executor. Keep repository-job policy validation strict and preserve original payload/columns as history.                              | Populated original-Phase-2 migration rehearsal now creates the old job before upgrade and actually executes it afterward with one attempt and receipt. Before fix it failed in FAILED state. Unit negative cases prove GitHub/other-local/unknown-version jobs never reach the workspace provider. |
| 4298392097, medium confidentiality | An authenticated owner sends bearer credentials in event source. The source was raw in the persisted event and integrity chain.                               | Sanitize and bound the display source before chain construction; keep original input only for the existing raw-input hash.                                                                            | Real PostgreSQL row canary, valid integrity chain, exact replay and changed raw-source conflict. Before fix the durable source contained the canary.                                                                                                                                               |
| 4298392117, high correctness       | Executor fails after its lease expires but before recovery takes the row lock; old finalizer dead-letters the final attempt.                                  | Require current unexpired token and actual claimed attempt in failure/completed reconciliation updates, as for publication. Zero affected rows means lost authority and leaves recovery to reconcile. | Real expired-before-recovery failure reproduced FAILED instead of untouched RUNNING. Added both deterministic expiry-first and concurrent failure/recovery executions, with no stale failure/audit and recovery exhaustion outcome.                                                                |

The PostgreSQL regressions run through `test:backend-security` after its existing
security groups. They operate only on unique synthetic tenants in an explicitly
opted-in disposable loopback database. The populated-upgrade helper runs only inside
the parent's generated p2upgrade schema. No customer database or production was used.

Disposition after local correction is implementation verification, not independent
acceptance. Final published-head CI and a fresh review remain required. Provider HTTP,
live OIDC and production behavior remain unverified. The newer exact-intent authority
package has a separate handoff/ADR and cannot be inferred from this review closure.

## Exact-intent candidate review: absolute-form ingress

Reviewed head: `b57fa8c48ae289de2fcc7f7a107baf33ee524f33`; Codex thread
4303856429 (medium, `apps/api/src/server.ts`, prior line 62). An authenticated
client can send an absolute-form request target (`POST http://host/api/v1/action-authority/intents`)
with duplicate nested preconditions. Express routes by pathname while the raw-URL
prefix guard skips verification. Native JSON parsing accepts the last value; a
valid intent is persisted with HTTP 201 instead of 400 AMBIGUOUS_JSON. This violates
the unambiguous-ingress contract and can disagree with an intermediary's first-value
interpretation. It does not bypass tenant authentication or enable provider dispatch.

Reproduction: a real Node HTTP request with a literal absolute-form target and a
valid signed local OIDC actor. The new PostgreSQL regression fails before correction
with `201 !== 400`. Correction mounts the verified parser on the authority prefix
using Express's own pathname matching, before the ordinary JSON parser; no custom
URL parser or dependency is added. Origin-form and mixed-case requests retain the
same boundary. The regression accepts a valid absolute-form intent, rejects duplicate
preconditions and alternate escaped keys (including mixed-case absolute paths) with
400 AMBIGUOUS_JSON, and verifies no rejected intent row exists. All ten authority
PostgreSQL groups pass after correction. The thread remains unresolved by this agent;
final new-head CI/review and Phase 2 acceptance remain pending.
