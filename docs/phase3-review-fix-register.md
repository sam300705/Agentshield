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
