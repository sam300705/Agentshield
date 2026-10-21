# GitHub Check publication transitions and trust boundary

Version: Phase 3 candidate 1. Not an action-execution authority or action-outcome receipt.
The Phase 2 HELD operation/outbox remains without a consumer in this version.

Authoritative local inputs: server-owned tenant/repository/installation identity and
selected-access state, durable scan/job state, verified receipt hash/coverage/gate.
Repository names are mutable provider routing metadata; restricted repository-ID
tokens narrow remote authority. Finding text, provider bodies and repository content
do not grant permission. Provider response IDs must be positive safe integers and
are persisted as strings; unsupported ranges are rejected rather than rounded.

| State/event                                           | Transition and replay rule                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PENDING, due, no live lease                           | Short claim increments generation and attempt, sets unique lease and IN_FLIGHT, persists possible-create marker and claim audit/request digest before HTTP |
| Another publisher has a live lease                    | No claim or HTTP; reread committed state later                                                                                                             |
| Scan projection unchanged, prior outcome OBSERVED     | No HTTP/attempt; defer polling five seconds; a changed durable scan state wakes it                                                                         |
| Successful create/update response                     | Unexpired token/generation fence, projection/delivery/audit in one transaction; OBSERVED, COMPLETE if terminal, otherwise PENDING                          |
| Known failure before any create dispatch              | Classify/back off or STOPPED; safe-to-create marker can be restored only when no create was dispatched and no older uncertainty exists                     |
| Possible create or crash with no acknowledged ID      | UNKNOWN; exact external-ID/SHA lookup; visible object may be updated, empty lookup never authorizes another create                                         |
| Lease expires/replacement generation exists           | Stale finalizer writes no projection, delivery or audit; current generation reconciles durable possible effect                                             |
| Audit/database failure after provider acknowledgment  | Finalization rolls back, committed dispatch marker survives; recover after lease expiry and reconcile instead of re-creating                               |
| Retry budget exhausted/nonretryable authority failure | STOPPED with safe failure/UNKNOWN state; operator retry retains possible-create history                                                                    |
| Local revocation before claim                         | No remote dispatch; STOPPED. Revocation/cancellation after claim cannot recall provider-accepted HTTP                                                      |

Migration requalifies legacy completed projections and treats legacy null IDs as
UNKNOWN. Never reset a possible-create marker merely to make retry succeed. Old
publishers must stop before migration; rollback retains fence-aware code/history.

Database fencing does not supply GitHub compare-and-swap or exactly-once creation.
Delayed remote application/visibility, genuine permission enforcement, rate limits
and controlled staging remain live-provider qualification items. Tenant lanes and
per-pass bounds are implemented; production fairness, latency/cost, restored-worker
reconciliation and mixed-binary rollout are unmeasured Phase 4 gates.

Correction checkpoint: claims lock and reload the publication row after advisory
admission so an overlapping successful finalizer cannot be overwritten from a stale
MVCC snapshot. Finalization and retry timestamps use PostgreSQL clock_timestamp().
A first create explicitly refused with nonretryable 401/403/404/422 is STOPPED with
its safe HTTP code and NOT_DISPATCHED, permitting an operator retry after correction.
This clears only new uncertainty; older possible-create history is preserved.
Transport failures, malformed/mismatched success and ambiguous 5xx remain UNKNOWN.
A successful create binds its returned ID only after exact external_id/head_sha
validation; reconciliation never treats a mismatched success as proof of absence.
