# Proposed action authority contracts and transitions

Design version: 1, 2026-10-15. **PROPOSED, not implemented by Phase 1.**
Existing session and receipt APIs remain documented in [API contracts](api-contracts.md).
These contracts must become strict versioned Zod schemas in `packages/schemas`
after predecessor acceptance, with reviewed privacy and compatibility behavior.

## Authoritative inputs and normalization

Derive tenant and authenticated actor from verified server identity. Verify resource
ownership in PostgreSQL and installation/repository authority against provider state.
Use immutable repository/provider IDs as decimal strings without numeric precision
loss; names and redacted text are display-only. Scanner evidence is descriptive;
only a server-verified immutable evidence digest/reference and freshness status may
bind an authorization. No model text or repository configuration grants authority.

Version normalization separately from schema. Reject unknown fields and duplicate
or ambiguous encodings at ingress; decode each defined encoding once, reject invalid
UTF-8/escapes, and never repeatedly decode an action into a different meaning.
Validate the supported operation's exact parameter dictionary and ref grammar.
Normalize commit SHA to the accepted full provider form; reject abbreviations.
Bind canonical typed values, not concatenated strings or presentation labels.
Changing normalization requires a new version and invalidates old approvals unless
an explicitly reviewed compatibility rule proves context equality.

Reject credentials in authoritative action parameters. Minimize stored raw context;
hashes of low-entropy private values are not anonymization. Document retention and
access before adding fields. Store readable sanitized display context separately.

| Contract       | Required versioned fields and authority                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action request | schema/normalization version; server tenant/actor; session; provider/installation; immutable repository ID; allowed action type; normalized parameters; base commit/relevant provider state; verified evidence digest; preconditions; tenant/actor-scoped idempotency key |
| Decision       | ID; policy revision; matched rule IDs/reasons; exact authorization-context digest; evidence freshness; decision (allow/deny/independent approval); expiry; required reviewer conditions                                                                                   |
| Approval       | ID; server reviewer and authority; independently checked actor separation; exact approved context; decision/policy revision; approve/reject reason; expiry/revocation; one admission reference on consumption                                                             |
| Execution      | operation/attempt IDs; admission reference; monotonic lease generation; provider idempotency reference if supported; checked preconditions; claim/dispatch/outcome timestamps; external object ID; observed outcome confidence; reconciliation state                      |
| Receipt        | schema/canonicalization versions; request/decision/execution references; sanitized evidence references; coverage/capture boundary; observed outcome; integrity hash; optional signature/key ID; verification limitations                                                  |

Context digest covers all authoritative action, evidence, precondition, policy and
expiry fields. It is computed server-side; caller-supplied digests are not trusted
without reconstruction. Approval consumption and operation admission plus audit
must be one short transaction. Audit failure rolls the transition back.

## State and replay rules

| Resource                | Allowed transitions and concurrency rules                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session (implemented)   | ACTIVE → COMPLETED; owned terminal replay is read-only. Creation key/context conflicts return 409. Closure and new event/decision/approval admission share a transaction lock. Prior decisions are not undone.          |
| Decision (proposed)     | Evaluate immutable context under a policy revision; deny is terminal for that context. Changed context or stale evidence requires a distinct decision.                                                                  |
| Approval (proposed)     | PENDING → APPROVED/REJECTED/EXPIRED/REVOKED; APPROVED → CONSUMED/EXPIRED/REVOKED. Lock and revalidate expiry, independence, current policy/context and session before atomic consumption/admission.                     |
| Operation (proposed)    | ADMITTED → READY → CLAIMED → OBSERVED_SUCCESS/OBSERVED_FAILURE/UNKNOWN. Retry only within budget and provider semantics; UNKNOWN → RECONCILING → observed state or still UNKNOWN. Each new claim increments generation. |
| Cancellation (proposed) | Before dispatch, atomically cancel admission. After dispatch, record cancellation intent and reconcile; never claim cancellation proves absence of a provider side effect.                                              |

Exact same key/context returns the original admission/result, including terminal
state; changed context is a conflict. A retry of that operation cannot consume a
second approval. A distinct operation needs distinct admission and authorization.
Revocation/closure wins if it commits before admission under the shared lock. An
admitted provider request can already be in flight; no retrospective atomicity is claimed.

Claim durable work and commit; perform HTTP without an open DB transaction; finalize
only with the current generation/lease. A stale finalizer cannot overwrite current
authority. Crash after provider success but before finalization yields UNKNOWN until
reconciled by immutable external identity/state. Never claim exactly-once execution.

## Candidate adapter, still gated

Evaluate only creating an allowed absent repository ref pointing at an approved
commit. Provider preflight alone cannot protect mutable state. Require provider
create semantics and tested existing-ref refusal; reconcile an ambiguous timeout
before any repeat. Provider Contents write scope is broader than this logical
operation, so isolate credentials outside the agent and restrict the adapter.
Do not expose merge, update-existing-ref, protected-branch writes, shell, deployment
or generic API forwarding. Live staging qualification and a scope ADR are required.

Receipts must distinguish hash-only, signature-verified, partial, stale and unknown
states. Verifiers need an independently trusted key/version and canonical payload.
A valid signature does not establish safe policy, complete capture, correct provider
behavior or tamper-proof storage against privileged database administration.
