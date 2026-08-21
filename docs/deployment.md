# Deployment

AgentShield has two deployment surfaces. The **Vercel preview** serves the React/Vite dashboard as a static frontend. The Express API, PostgreSQL database, and durable scan worker remain separate services and are not implicitly provided by the static preview.

## Static dashboard preview

A Vercel project connected to this repository should use the Git-linked repository with `apps/web-dashboard` as its root directory, install with the frozen lockfile, build the dashboard workspace, and publish its `dist` directory. Client-side routes are rewritten to `index.html` so refreshes work on nested dashboard paths.

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

## Render API and worker with Neon PostgreSQL

The repository includes a credential-free `render.yaml` Blueprint for the API and durable scan worker. It intentionally does not provision a database or embed secrets. Create a Neon project, copy both connection strings from Neon’s **Connect** dialog, and enter them as the Render environment-group values described below. Neon recommends the pooled URL for application traffic and the direct, unpooled URL for Prisma CLI migrations.[1] [2]

| Variable                | Render value                                                             | Used by                    |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------- |
| `DATABASE_URL`          | Neon pooled URL, with `sslmode=require` and a suitable `connect_timeout` | API and worker runtime     |
| `DATABASE_URL_UNPOOLED` | Neon direct URL, without the `-pooler` hostname suffix                   | `prisma migrate deploy`    |
| `CORS_ORIGIN`           | The exact Vercel dashboard origin                                        | API                        |
| `AUTH_MODE`             | `oidc`                                                                   | API and worker environment |
| `DEMO_AUTH_ENABLED`     | `false`                                                                  | API and worker environment |
| `OIDC_ISSUER`           | Approved identity-provider issuer                                        | API                        |
| `OIDC_AUDIENCE`         | Approved API audience                                                    | API                        |
| `OIDC_JWKS_URL`         | Approved JWKS endpoint                                                   | API                        |
| `OIDC_ROLE_CLAIM`       | `roles` or the approved claim name                                       | API                        |

Import the repository as a Render Blueprint from the `agent/production-hardening` branch. The web service runs `pnpm --filter @agentshield/api start`, probes `/health/ready`, and applies committed migrations with `pnpm db:deploy` before starting. The background worker runs `pnpm --filter @agentshield/api worker` and has no public endpoint. Render’s service model separates public web services from background workers, which are intended for continuously running queue processors.[3]

Do not run `pnpm db:migrate`, `pnpm db:push`, or `pnpm db:seed` against the Neon production database. Review committed SQL migrations first, take the provider-managed backup required by your operating procedure, and run only `pnpm db:deploy` from the Render pre-deploy command. Keep the Vercel frontend’s `VITE_API_BASE_URL` unset until the API has a verified HTTPS URL and the API’s `CORS_ORIGIN` is set to the exact frontend origin.

### Deployment references

[1]: https://neon.com/docs/guides/prisma "Neon Prisma connection guide"
[2]: https://neon.com/docs/guides/prisma-migrations "Neon Prisma migration guide"
[3]: https://render.com/docs/service-types "Render service types"

## Azure student-credit deployment

For a credit-funded always-on worker, see [`deploy/azure/README.md`](../deploy/azure/README.md). The Azure path runs the API and worker as separate containers on one Linux VM, puts Caddy in front for HTTPS, and uses Neon for PostgreSQL. The dashboard must be rebuilt with `VITE_API_BASE_URL` set to the public HTTPS API origin; the API must set `CORS_ORIGIN` to the exact Vercel origin. The Azure VM and Neon account are external resources, so this repository includes configuration and runbooks but does not create them automatically.
