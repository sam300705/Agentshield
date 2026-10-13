# Prisma

The PostgreSQL schema and reviewed baseline migration cover scans, jobs, organizations, RBAC membership, agent sessions/events, attack graphs, versioned policies, simulations, evidence, receipts, integrations, and behavior baselines.

Use the root database scripts:

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed
```

Use `pnpm db:migrate` only while authoring a new local migration. Shared and production-like environments should apply committed migrations with `pnpm db:deploy`.
