# ADR: Phase 2 authorizes and admits intent; provider dispatch stays disabled

Status: implementation decision for the authorized Phase 2 scope. Provider adapter
selection/activation remains a separate Phase 3 decision and acceptance gate.

The existing SDK submits descriptive action/resource strings, and its approval is
cooperative. That contract cannot authorize a provider adapter because it lacks
immutable repository, commit, evidence, policy, expiry and one-operation consumption.
Keep it compatible and separate from the new authority tables and endpoints.

Define a versioned narrow intent for the proposed absent-ref candidate: GitHub
immutable repository identity, full lowercase commit, a ref inside
`refs/heads/agentshield/`, and `targetMustBeAbsent: true`. Reject percent encoding,
backslashes, Unicode and Git ref ambiguity rather than guessing normalization.
This supplies a testable exact-context admission contract without shipping a provider
write operation. No shell, merge, update-existing-ref or API passthrough is admitted.

A tenant policy defaults to unavailable until a policy administrator explicitly
configures DENY or REQUIRE_APPROVAL. Every policy update gets a new revision. There
is no allow-without-review path in this package. Changing policy revokes the utility
of prior unconsumed approvals even if policy later changes back.

The server reconstructs repository/installation ownership and immutable scan receipt
binding. Only completed, recent, COMPLETE coverage evidence for the same repository
and commit qualifies. A valid receipt hash is integrity evidence within the trusted
application/database boundary, not a claim of scan safety, complete capture, signature
verification or resistance to a database administrator. Denied scan gates fail closed.

Admission atomically consumes one reviewed context, creates one durable operation and
one HELD outbox record, and records audit. No worker consumes this outbox. API results
must explicitly say dispatch is disabled and must never imply an observed provider
outcome. A later adapter must revalidate mutable provider authority/preconditions,
use short claim/remote/fenced-finalization and reconcile unknown outcomes.

Use the existing PostgreSQL transactions, tenant policy/session locks and strict Zod
contracts; no new broker, orchestrator or policy engine dependency is justified.

HELD records from this schema version must never be automatically promoted to
provider-ready work by an upgrade. A later adapter requires a new explicit contract
and fresh qualifying admission. These operations permanently describe admission
without dispatch, or cancellation. Approval expiry is checked against PostgreSQL's
clock again at the atomic consumption statement, after resource validation locks.
