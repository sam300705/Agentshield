# Azure VM deployment

This directory describes a **credit-funded, self-managed deployment** for AgentShield. It runs the API and durable scan worker on one Azure Linux VM and uses Neon for managed PostgreSQL. It does not create cloud resources, request credentials, or enable billing by itself.

## Architecture

The Vercel dashboard calls the public Caddy HTTPS endpoint. Caddy forwards traffic to the internal API container. The worker runs as a separate container against the same Neon database and claims durable scan jobs. Prisma uses the pooled Neon URL at runtime and the direct Neon URL for migrations.

| Service    | Runtime            | Public access                    |
| ---------- | ------------------ | -------------------------------- |
| Dashboard  | Vercel static site | Public Vercel URL                |
| Caddy      | Azure VM container | TCP 80/443                       |
| API        | Azure VM container | Internal port 3001 through Caddy |
| Worker     | Azure VM container | No public port                   |
| PostgreSQL | Neon Free          | Public TLS connection strings    |

## Prerequisites

You need an Azure subscription with remaining student credit, an Azure Linux VM with Docker Compose support, a DNS name pointing to the VM’s public IP, a Neon project, and an OIDC provider. The GitHub Student Developer Pack currently lists Azure access and $100 in Azure credit for eligible students aged 18+ without requiring a credit card. The credit is finite; configure cost alerts before creating the VM.

Create `deploy/azure/azure.env` from `azure.env.example` on the VM. Replace every placeholder and keep the file outside Git. The VM must contain both Neon URLs: `DATABASE_URL` is pooled for the API and worker, while `DATABASE_URL_UNPOOLED` is direct for `prisma migrate deploy`. Set `DOMAIN` to the DNS name that points to the VM and set `CORS_ORIGIN` to the exact Vercel origin.

## Azure resource setup

Create the resource group, virtual network, VM, and public IP through the Azure Portal or Azure CLI according to the student-credit limits. Select the smallest supported Linux VM size, enable automatic shutdown as a safety measure if 24/7 operation is not required, and allow only TCP 22, 80, and 443 in the network security group. Do not expose PostgreSQL or API port 3001 publicly.

Before starting services, install Docker Engine and the Compose plugin on the VM, clone the repository, create `deploy/azure/azure.env`, and run:

```bash
cd /opt/agentshield
docker compose -f deploy/azure/docker-compose.yml up -d --build
docker compose -f deploy/azure/docker-compose.yml ps
```

The API container applies committed migrations before starting. Verify the public endpoint with:

```bash
curl -fsS https://api.example.com/health/live
curl -fsS https://api.example.com/health/ready
```

Then set the Vercel project variable `VITE_API_BASE_URL` to the same HTTPS API origin and redeploy the dashboard. The API’s `CORS_ORIGIN` must exactly match the Vercel origin.

## Cost controls

Azure credit is not an unlimited free tier. Create a budget alert below the remaining credit, monitor the VM’s daily cost, and stop or delete the VM before the balance is exhausted. Automatic shutdown is recommended for development or demonstrations. The deployment should remain on the smallest VM that can build and run the API and worker; do not enable autoscaling or additional disks unless the credit budget explicitly permits it.

Neon Free also has finite limits and scale-to-zero behavior. Keep the database below its storage and compute allowances, avoid unnecessary branches, and export a logical backup before destructive schema work. Never run `prisma db push` or `prisma db seed` against the production database; use reviewed migrations and `pnpm db:deploy` only.

## Operations

Use Docker Compose restart policies for routine VM restarts. Inspect logs with:

```bash
docker compose -f deploy/azure/docker-compose.yml logs --tail=200 api worker caddy
```

If the API is unhealthy, stop the public proxy first, inspect the API and database readiness logs, and restore the last known-good Git commit before retrying. Do not paste environment files, OIDC secrets, Neon URLs, or OpenRouter keys into GitHub issues or chat.
