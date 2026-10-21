# Phase 3 integration failure and correction register

This records implementation evidence, not independent acceptance. The historical
Phase 3 code starts at 49d2274c601a63b88aadcaa511526af1bb90946a.

| Failure/prerequisite                                                           | Impact                                                                                                         | Correction and regression                                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider stalls inside publisher's long transaction                            | Job/scan transitions and publication lock stay blocked by network; medium availability/correctness             | Short committed claim/HTTP/fenced finalization. Actual paused-HTTP/independent PostgreSQL lock probe fails against legacy code and passes correction                                |
| Remote create precedes local crash or audit rollback                           | Local ID disappears; retry may create a second object; medium correctness                                      | Committed possible-create marker, conservative empty lookup, UNKNOWN and bounded reconciliation. Actual post-provider audit failure and invisible-object fixtures retain one create |
| Lease expires while old HTTP response remains outstanding                      | Stale worker can overwrite newer projection/audit; medium integrity                                            | Database clock/token/generation fenced mutation. Real HTTP pause, cancel, lease replacement, response release preserves newer terminal state and one success audit                  |
| Completed scan has partial/invalid evidence but no blocking finding            | Old Check can be green despite incomplete capture; high integrity when consumers rely on this required Check   | Verified receipt coverage/gate before success; valid-hash partial fixture yields action_required                                                                                    |
| Repository name is reused/renamed with broad installation token                | Check routing can address unintended repository under shared installation; high conditional authorization risk | Request repository_ids-scoped Checks write token; scan uses Contents read token. Unit and real HTTP body/permission assertions; actual GitHub guarantee NOT RUN                     |
| Selection lifecycle adds lock order/access flag to older authority             | Approval could survive deselection or deadlock with installation/repository lifecycle                          | Shared installation-before-repository order, selected-access reread, real authority refusal regression                                                                              |
| Transaction-safe createMany(skipDuplicates) replaces throwing insert           | Existing claim could be treated as newly owned, or retry recovery skipped                                      | Explicit count check then original hash/attempt CAS recovery; real dedupe, rollback/redelivery and backend retry tests retained                                                     |
| Timestamp-based predecessor filter includes newly introduced old migration IDs | Passing rehearsal labels a different history than intended                                                     | Explicit Phase 3 migration exclusions and four precise populated histories, including HELD customer records and legacy publication uncertainty                                      |

Additional provider-contract corrections: the old client reused a create payload
(including head_sha) for PATCH, and selected the first matching external ID without
checking later pages. Two targeted tests failed before correction. Separate wire
payloads now omit create-only fields on update; duplicate matches fail closed as
UNKNOWN, and update responses must retain the requested provider ID. The real HTTP
simulator now rejects the old PATCH shape instead of mirroring that assumption.
These are correctness/integrity corrections; actual GitHub validation/ordering
remains unqualified.

No old thread was resolved, no gate was self-awarded and no production rollout
occurred. Final exact-head CI, independent review and controlled live-provider
qualification remain required. See the current Phase 3 handoff.

## PR #18 review correction checkpoint (2026-10-21)

All four current review threads concern `e501891`; outdated positions are not
resolution evidence. Each correction requires a fresh published-head review.

| Finding/thread                                           | Severity and concrete prerequisite/impact                                                                                                                             | Correction and regression                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4304119699: overlapping/shifting repository pages        | Medium: selection changes/provider overlap while paging can omit one ID while raw length equals count; synchronization changes admission mappings incorrectly         | Reject duplicate/unsafe IDs and changed/missing count across pages. Three unit scenarios fail before/pass after; real PostgreSQL snapshot rejection preserves every customer mapping. Provider offers no atomic multi-page snapshot guarantee.                                |
| 4304119704: retry clock skew                             | Medium: slow/fast application clock bypasses/delays database-clock backoff, exhausting recovery budget or delaying publication                                        | Use database clock in finalization for scheduling and completion timestamps. Real HTTP transient failure moves app clock one hour behind; fail-before/pass-after future retry and no immediate extra attempt.                                                                 |
| 4304119709: definitive create refusal treated as unknown | Medium: initial nonretryable 401/403/404/422 permanently prevents creation even after operator repairs credentials/request                                            | Explicit refused POST retains safe HTTP failure, STOPPED/NOT_DISPATCHED and clears only newly established uncertainty. Four real HTTP statuses followed by operator-equivalent retry create successfully; ambiguous 503 and invisible-effect tests still permit no duplicate. |
| 4304119712: mismatched successful create identity        | Medium: provider/proxy returns unrelated Check ID/context; later PATCH can target wrong object                                                                        | Validate external_id and head_sha before returning ID. Two failing-before unit cases; real HTTP mismatches persist no ID, retain UNKNOWN and reconcile actual exact-context object without another create.                                                                    |
| Local finalizer/claim race                               | Medium: successful finalizer holds publication row past lease expiry while next claim reads old MVCC version; blind claim can overwrite committed COMPLETE projection | Lock publication row before reading claim state. Actual PostgreSQL audit barrier proves contender waits on finalizer, preserves COMPLETE/OBSERVED/generation and emits no extra HTTP; failed before/passed after.                                                             |
| Local dot-prefixed repository rejection                  | Low correctness: valid `.github` repository cannot synchronize                                                                                                        | Permit dot-prefixed components while rejecting dot/dot-dot path components. Positive regression failed before/passed after.                                                                                                                                                   |

Automated feedback is supporting evidence, not independent human acceptance.
Live provider, restore/production/mixed-binary behavior and demand validation remain
unverified. P3-D2 involves no migration, customer record deletion or production change;
the additional P3-D3 migration is recorded below.

### Additional upgrade finding from review 5559617043

Medium, current code still affected despite the review linking the older immutable
lifecycle migration: pre-access-flag repositories retained after deselection become
trusted through default true during upgrade. An active linked installation is the
prerequisite; stale scan/action admission is the impact until fresh synchronization.
Correction: additive 20261021140000 migration revokes only cached GITHUB access,
requiring verified selection refresh. Four populated histories now include linked
stale/selected mappings and retained scan history. The new legacy-selection assertion
failed before the migration. Afterward it passes, real queue admission rejects both
unvalidated mappings without creating work, and real synchronization restores only the
selected ID. LOCAL/customer/HELD/history preservation checks remain. No old migration
is edited, no thread is resolved and no production upgrade/rollback is claimed.

### P3-Q1 read-only diagnostic boundary

The historical inline verifier could print PASS with a mismatched returned provider
ID/conclusion, incomplete receipt, stale selection or unqualified signature. It also
requested a broad token. Extract a scoped read-only verifier, validate exact lineage/
receipt/Check state, and recheck context after HTTP without holding a transaction.
Actual HTTP/PostgreSQL tests reject five provider field mismatches, foreign tenant,
unsafe/ambiguous ID, UNKNOWN/stale projection, tampered/partial/legacy-without-coverage/
missing receipt payload, and in-flight suspend/deselect/unknown transitions. They
assert no provider writes and honest UNSIGNED/NOT_VERIFIED output. Tagged PostgreSQL
activity verifies no open transaction across the paused HTTP response. This qualifies
the helper called by the CLI, not shell parsing or actual live GitHub behavior.
