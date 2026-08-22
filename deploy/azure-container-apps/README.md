# Azure Container Apps deployment

This is the **no-card alternative** to the VM deployment. It uses Azure Container Apps Consumption for the API and a scheduled Container Apps Job for the PostgreSQL-backed scan worker. Azure provides the API HTTPS hostname; no VM, public IP, Caddy container, or custom domain is required for the first deployment.

The API and worker use the same container image. The API runs `node apps/api/dist/index.js`. The scheduled job runs `node apps/api/dist/worker.js` with `WORKER_MODE=once`; it processes all currently eligible jobs and exits when the queue is empty. PostgreSQL remains external, using the free Neon plan.

## Requirements

You need an active **Azure for Students** subscription and Azure Cloud Shell. Azure for Students does not require a credit card. You also need a free Neon PostgreSQL project and a production OIDC provider. Do not use the VM wizard or select D-series VM sizes.

The Container Apps Consumption plan currently includes monthly free grants of 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million HTTP requests per subscription. Usage beyond those grants can consume Azure student credits, so monitor Cost Management and keep the API at zero minimum replicas and one maximum replica. The scheduled worker should use 0.25 CPU and 0.5 GiB memory and should run once per minute only if one-minute scan latency is required.

## Deploy from Azure Cloud Shell

Clone the production branch in Cloud Shell and enter the repository:

```bash
git clone --branch agent/production-hardening https://github.com/sam300705/Agentshield.git
cd Agentshield
```

Register the Container Apps provider and install the CLI extension:

```bash
az provider register --namespace Microsoft.App
az extension add --name containerapp --upgrade
```

Set a location where Container Apps is available. `eastus` is only an example; use a region shown as available by your subscription:

```bash
export RESOURCE_GROUP=agentshield-ca-rg
export LOCATION=eastus
export ENVIRONMENT=agentshield-ca-env
export API_APP=agentshield-api
export WORKER_JOB=agentshield-worker
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
az containerapp env create --name "$ENVIRONMENT" --resource-group "$RESOURCE_GROUP" --location "$LOCATION"
```

Build and deploy the API from source. The command uses Azure’s managed build path and creates or uses a container image for the app. Keep the generated registry resource inside the same resource group so it can be monitored and removed later if it is not needed:

```bash
az containerapp up \
  --name "$API_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --environment "$ENVIRONMENT" \
  --source . \
  --ingress external \
  --target-port 3001 \
  --min-replicas 0 \
  --max-replicas 1
```

The command prints the Container Apps HTTPS URL. Save it as the API origin:

```bash
export API_ORIGIN="https://<the-generated-container-app-hostname>"
```

## Configure secrets

Set these shell variables from the Neon Connect dialog and your OIDC provider. Do not commit them, paste them into GitHub issues, or put them in frontend code:

```bash
export DATABASE_URL='postgresql://...'
export DATABASE_URL_UNPOOLED='postgresql://...'
export OIDC_ISSUER='https://...'
export OIDC_AUDIENCE='...'
export OIDC_JWKS_URL='https://.../.well-known/jwks.json'
export OIDC_ROLE_CLAIM='roles'
export CORS_ORIGIN='https://agentshield-gov0eexcc-sam300705s-projects.vercel.app'
```

Update the API with secret-backed environment variables. The exact command shape can vary with the installed Azure CLI extension; use `az containerapp secret set --help` if the extension reports a syntax change. Secret names are lower-case here, while environment variable names remain upper-case:

```bash
az containerapp secret set --name "$API_APP" --resource-group "$RESOURCE_GROUP" --secrets \
  database-url="$DATABASE_URL" \
  database-url-unpooled="$DATABASE_URL_UNPOOLED" \
  oidc-issuer="$OIDC_ISSUER" \
  oidc-audience="$OIDC_AUDIENCE" \
  oidc-jwks-url="$OIDC_JWKS_URL"

az containerapp update --name "$API_APP" --resource-group "$RESOURCE_GROUP" --set-env-vars \
  NODE_ENV=production \
  PORT=3001 \
  AUTH_MODE=oidc \
  DEMO_AUTH_ENABLED=false \
  OIDC_ROLE_CLAIM="$OIDC_ROLE_CLAIM" \
  CORS_ORIGIN="$CORS_ORIGIN" \
  DATABASE_URL=secretref:database-url \
  DATABASE_URL_UNPOOLED=secretref:database-url-unpooled \
  OIDC_ISSUER=secretref:oidc-issuer \
  OIDC_AUDIENCE=secretref:oidc-audience \
  OIDC_JWKS_URL=secretref:oidc-jwks-url
```

Apply migrations from Cloud Shell using the same image or a temporary local Node environment. Never use `db:push` against Neon production:

```bash
export DATABASE_URL="$DATABASE_URL"
export DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
```

## Create the scheduled worker job

Retrieve the API image used by the deployment:

```bash
export IMAGE=$(az containerapp show \
  --name "$API_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query 'properties.template.containers[0].image' \
  --output tsv)
printf '%s\n' "$IMAGE"
```

Create a Consumption scheduled job that runs once per minute. It has no public ingress and uses the same database/OIDC configuration. The job exits after its queue batch is empty:

```bash
az containerapp job create \
  --name "$WORKER_JOB" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENVIRONMENT" \
  --trigger-type Schedule \
  --cron-expression '*/1 * * * *' \
  --replica-timeout 900 \
  --replica-retry-limit 0 \
  --parallelism 1 \
  --replica-completion-count 1 \
  --image "$IMAGE" \
  --cpu 0.25 \
  --memory 0.5Gi \
  --command node apps/api/dist/worker.js \
  --env-vars \
    NODE_ENV=production \
    WORKER_MODE=once \
    DATABASE_URL=secretref:database-url \
    DATABASE_URL_UNPOOLED=secretref:database-url-unpooled \
    AUTH_MODE=oidc \
    DEMO_AUTH_ENABLED=false \
    OIDC_ISSUER=secretref:oidc-issuer \
    OIDC_AUDIENCE=secretref:oidc-audience \
    OIDC_JWKS_URL=secretref:oidc-jwks-url \
    OIDC_ROLE_CLAIM=roles \
  --secrets \
    database-url="$DATABASE_URL" \
    database-url-unpooled="$DATABASE_URL_UNPOOLED" \
    oidc-issuer="$OIDC_ISSUER" \
    oidc-audience="$OIDC_AUDIENCE" \
    oidc-jwks-url="$OIDC_JWKS_URL"
```

If the CLI does not accept `secretref:` during job creation, create the job first with non-secret variable names omitted, then use `az containerapp job update --help` and configure the job secrets and secret references through its YAML template. Never put the actual connection strings in a committed YAML file.

## Connect the dashboard

Set `VITE_API_BASE_URL` in the Vercel project to the generated Container Apps HTTPS URL, rebuild the dashboard, and verify that the API CORS origin exactly matches the Vercel deployment origin. Keep demo authentication disabled in production.

## Cost and shutdown controls

Use Azure Cost Management to monitor the student credit balance and configure a budget alert. Keep the API minimum replicas at zero, the maximum at one, and the worker schedule at five minutes if one-minute scan latency is not needed. Stop or disable the API and worker when the deployment is no longer required; delete the resource group only after explicit operator approval and a retention decision. Do not upgrade the subscription to Pay-As-You-Go.

The Container Apps free grant is not a contractual guarantee of zero usage for every workload. It is safe from surprise card charges only while the subscription remains Azure for Students and is not upgraded; usage can still consume the student credit balance.

## Verification

Check the API endpoints:

```bash
curl -fsS "$API_ORIGIN/health/live"
curl -fsS "$API_ORIGIN/health/ready"
```

Then log in through the Vercel dashboard, enqueue a scan, confirm the scheduled job completes it, and verify tenant-scoped findings, approvals, and audit events. The API, Neon database, OIDC provider, and scheduled worker must all be working before describing the public system as production-ready.

## Sources

- [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [Azure Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- [Azure Container Apps jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Azure Container Apps ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)
- [Neon pricing](https://neon.com/pricing)
