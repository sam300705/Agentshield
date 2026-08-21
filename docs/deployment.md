# Deployment

AgentShield has two deployment surfaces. The **Vercel preview** serves the React/Vite dashboard as a static frontend. The Express API, PostgreSQL database, and durable scan worker remain separate services and are not implicitly provided by the static preview.

## Static dashboard preview

The repository includes `vercel.json` at the root. A Vercel project connected to this repository should use the repository root as its project directory, install with the frozen lockfile, build the dashboard workspace, and publish `apps/web-dashboard/dist`. Client-side routes are rewritten to `index.html` so refreshes work on nested dashboard paths.

The static dashboard can display its deterministic offline demo without a backend. It must not be presented as proof that the API, database, authentication, or worker are deployed.

## API and worker architecture

A production-minded installation runs the API and worker as separate Node.js processes against the same PostgreSQL database:

```text
Browser -> API service -> PostgreSQL
                     -> ScanJob table <- durable worker
                     -> scanner / policy engine / receipts
```

The worker uses PostgreSQL-backed job state with atomic claims, bounded retries, cancellation flags, and stale-lock recovery. It must run on a service that supports a long-lived process; it must not be represented as a serverless function that may be terminated between polling cycles.

## Required environment variables

Set these variables on the API and worker services. Values are intentionally not included here.

| Variable            | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`          | Use `production` for production services.                         |
| `API_PORT`          | API listener port.                                                |
| `CORS_ORIGIN`       | Exact dashboard origin allowed by CORS.                           |
| `DATABASE_URL`      | PostgreSQL connection string supplied by the deployment platform. |
| `AUTH_MODE`         | Set to `oidc` when production OIDC is active.                     |
| `OIDC_ISSUER`       | Expected issuer claim for verified access tokens.                 |
| `OIDC_AUDIENCE`     | Expected audience claim for verified access tokens.               |
| `OIDC_JWKS_URL`     | JWKS endpoint used to verify token signatures.                    |
| `OIDC_ROLE_CLAIM`   | Claim containing an AgentShield role or role list.                |
| `DEMO_AUTH_ENABLED` | Must be `false` or unset in production.                           |

Production authentication fails closed unless a verified OIDC token is present and contains a subject, supported role, and organization context. The `x-agentshield-demo-user` header is accepted only when `DEMO_AUTH_ENABLED=true` outside production.

## Health checks

Use `GET /health/live` for process liveness. Use `GET /health/ready` for database readiness; it returns HTTP 503 when PostgreSQL is unavailable. Protected application routes require verified authentication and organization-scoped authorization.

## Database migration and seed safety

Apply committed migrations with `pnpm db:deploy`. Do not use `pnpm db:push` against a production database. The demo seed is for an isolated development database and should not be run against production data. Before migration, take a platform-managed backup and validate the rollback or forward-recovery plan.

## Rollback

For the dashboard, use the Vercel deployment history to promote the previous known-good deployment without deleting the current deployment. For the API and worker, redeploy the previous immutable Git commit, keep the database schema at the newest compatible migration, and stop or drain the worker before rolling back application code. Never force-push or rewrite the release branch.

## Current verified boundary

The repository’s local quality gates verify the dashboard build, API build, Prisma migration application, scanner, and package tests. A successful static preview does not verify a deployed API-to-database-to-worker flow. That flow requires external PostgreSQL, OIDC, and long-lived worker configuration.

## Vercel project settings

For the Git-linked `agentshield` Vercel project, use the following values when the repository is configured as a pnpm monorepo:

| Setting          | Value                |
| ---------------- | -------------------- |
| Framework preset | Vite                 |
| Root directory   | `apps/web-dashboard` |
| Install command  | `pnpm install`       |
| Build command    | `pnpm run build`     |
| Output directory | `dist`               |

The Git connection must point to `sam300705/Agentshield`; these settings cannot work against an uploaded source tree that omits the `apps/web-dashboard` directory. Redeploy after saving the settings so the deployment uses the current Project Settings rather than an older production override.
