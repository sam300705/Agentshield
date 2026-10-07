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
