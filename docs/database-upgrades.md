# Existing database upgrades

Fresh empty databases use `pnpm db:deploy`. Keep all committed migration SQL and checksums unchanged. Do not reset populated databases or use `db:push` in the release path.

An installation created with the earlier Prisma workflow may have tables but no migration history. Before its first migration deployment, use the baseline workflow below. Normal `migrate deploy` cannot create those tables again. This is a one-time database maintenance action, not a production action performed by this remediation.

1. Back up the database and verify the restore procedure. Stop application writes and concurrent migration jobs. Use the deployment's existing unpooled migration credentials through its secret manager; never paste the URL in chat or commit it.
2. Configure `DATABASE_URL_UNPOOLED` for the intended target/schema and run `pnpm db:baseline --apply`. The explicit flag is required.
3. The command rehearses the immutable migration prefixes in a uniquely named temporary schema. It compares table/column types, defaults, constraints, indexes, enums, views/sequences, RLS policies, triggers, and routines. Only a matching prefix is recorded with Prisma `migrate resolve --applied`; no target application rows are changed. It needs permission to create and drop the temporary schema.
4. Run `pnpm db:deploy` to apply the remaining incremental migrations, then check `prisma migrate status`, application readiness, and preserved historical data before resuming writes.

Unknown schema drift or nonempty migration history is refused. Do not silence that refusal by marking arbitrary migrations applied. An installation with a previously failed migration needs its own inspected recovery plan. If a history write is interrupted, inspect recorded migration status and finish only the verified prefix; do not rerun an unexamined reset. Existing deployments may differ from the supported snapshots and require a separately reviewed incremental reconciliation.

The baseline command never runs automatically from Render, a worker, or API startup. Render's existing `pnpm db:deploy` remains unchanged; a populated pre-history target needs the verified baseline before that deploy command. Ordinary existing databases already tracking migrations continue their normal incremental path.

CI uses real PostgreSQL to create a pre-history control-plane database with persisted scan data, execute the same baseline command and incremental deploy, verify all history entries and unchanged scan contents, and reject deliberately introduced drift. Fresh migration deployment remains an independent existing CI gate. These fixtures qualify the workflow without claiming a real deployed database was upgraded.

Reference: [Prisma v6 baseline workflow](https://www.prisma.io/docs/orm/v6/prisma-migrate/getting-started).

## Phase 1 lifecycle forward migration

`20261015120000_phase1_session_lifecycle` adds nullable session idempotency/context
columns, a tenant/actor/key unique index and three audit enum values. Existing SQL
and checksums remain unchanged; old sessions retain NULL fields. Coverage is held
in existing JSON scan metadata and canonical receipt payloads without rewriting
historical rows. The populated upgrade regression now checks preserved tenant,
session, audit and receipt identity/digests as well as scan data.

`AGENTSHIELD_DISPOSABLE_DATABASE=true pnpm test:phase1-completion` additionally
requires the existing localhost database guard. Run it only in an explicitly
provisioned disposable database named `agentshield`. It injects test-tenant audit
failures and replaces labelled synthetic demo seeds. It proves create/close and
retry-transition rollback, claim/closure races, collision persistence/advisory
identity, unsigned coverage receipts and seed preservation/rollback/serialization.
A customer-owned fixture in the demo tenant survives, including its audit and
receipt. Cleanup targets generated test-owned IDs; importing `prisma/seed.ts`
does not run its CLI. These test hooks are not production recovery commands.

## Monotonic scan claim numbering

`20261015190000_scan_claim_sequence` additively adds non-null `ScanJob.claimSequence`
with default zero. Every new-worker claim increments it in the claim/audit transaction;
shutdown may restore the retry-budget `attempts` counter but never this sequence.
Archived failures and cancellation history distinguish `CLAIM_SEQUENCE` from
`LEGACY_RETRY_COUNTER` and retain the separate retry-budget value.

Zero on historical rows means no post-upgrade claim has been numbered. It does not
assert that the job never ran. Old lifetime execution counts cannot be reconstructed;
legacy audits are never rewritten. The populated-upgrade regression preserves a
failed job's identity, status, retry count and failure context while verifying zero
initial sequence, alongside existing customer scan/audit/receipt/session preservation.

Drain/stop old workers before upgrading and start only migrated, regenerated-client
workers. Mixed old/new workers cannot promise this numbering because old workers do
not increment the column. For code rollback, stop workers, retain the additive column
and history, and acknowledge that old code restores its earlier retry-numbering
limitations. No schema rollback/drop or production operation is performed here.

## Phase 2 authorization-only expansion

`20261016200000_action_authority_admission` adds policy/authorization/operation/held
outbox tables and audit labels. It does not reinterpret legacy approvals or receipts.
Owner-consistent SQL foreign keys and checks supplement Prisma scalar models; retain
these manual constraints in future migrations and never use db push as an upgrade.
Populated histories from accepted Phase 1 and original Phase 2 are rehearsed by
`pnpm test:phase2-upgrade`, including execution of the old supported demo payload.
The predecessor migration directory is copied byte-for-byte into an isolated schema,
then the real merged migration directory is deployed. The observer reconnects after
DDL to avoid cached SELECT \* result types. Unknown unversioned schemas still fail
closed; this is not a blanket baseline for arbitrary drift.

Rollout requires expanding schema and upgrading every API/worker/audit reader before
configuring an authority policy. New audit enum labels are incompatible with unaware
Prisma clients once new events exist. Before activation, code rollback retains the
unused additive schema. After activation, disable admission with a new DENY policy
revision and retain a compatible reader binary or forward compatibility patch; do
not assume an old binary ignores unknown enum values, and do not delete audit/history
for rollback. Production binary rollback and mixed-version operation are NOT RUN and
remain Phase 4 qualification. This work performs no production migration or rollout.
Out-of-order missing migrations are tested; enum ordering is not an authorization
input or an application ordering contract.
