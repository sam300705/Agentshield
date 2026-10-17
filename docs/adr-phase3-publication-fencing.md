# ADR: GitHub Check publication uses durable claims and conservative reconciliation

Status: implemented candidate, independent review/live qualification pending.

The imported Phase 3 publisher holds a database transaction across remote HTTP,
blocking job transitions and rolling back its local create identity after crashes.
A real paused-HTTP regression reproduced the retained advisory transaction lock.

Extend existing PostgreSQL projections with additive lease/generation, dispatch
uncertainty and observation state. Do not add a broker/orchestrator or new service
dependency. Record a claim audit/request digest atomically before any HTTP, then perform HTTP
outside the transaction; fenced finalization and
audit in one short transaction. Generation plus database clock rejects expired or
replaced finalizers. Provider identity comes from server-owned records, and GitHub
tokens are restricted to the intended immutable repository and required permission.

Before an uncommitted remote create, persist that creation may occur. If the process
crashes or the create outcome is ambiguous, query the exact external ID and commit.
Update a visible object; never infer absence or blindly re-create from empty lookup.
Bound reconciliation/backoff to ten attempts and expose UNKNOWN/STOPPED for operator
recovery. Legacy null-ID rows receive the same conservative uncertainty on upgrade.
This can require operator investigation after a crash before actual dispatch; that
is preferable to claiming an absent remote effect without provider idempotency.

Checks are descriptive evidence, not authority for agent repository writes. Invalid,
missing or partial receipt evidence cannot yield success; the receipt gate remains
conservative against missing finding rows. Phase 2 HELD action operations remain
permanently without a consumer in this version. No create-ref operation is added.

Fencing protects application state, not remote GitHub request ordering. Already
accepted HTTP can finish after local timeout, cancellation/revocation or lease loss.
GitHub Check creation lacks an enforced unique external-ID key, and update lacks our
generation compare-and-swap. Do not claim exactly-once execution, perfect remote
ordering, production readiness or complete capture. Controlled live qualification
and incident reconciliation remain required.

Rollout drains old publishers; rollback keeps fence-aware code and expanded history.
Tests cover actual independent PostgreSQL locks, concurrent publishers, lease expiry,
audit failure after remote effect, visibility loss and bounded unknown outcomes.
Production performance, backup restore and mixed-version rollback remain Phase 4.
