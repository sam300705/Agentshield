#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
elif corepack pnpm --version >/dev/null 2>&1; then
  # Create a local shim so nested scripts (e.g. pnpm --parallel ...) also resolve pnpm
  mkdir -p "$ROOT_DIR/.bin"
  cat > "$ROOT_DIR/.bin/pnpm" << 'SHIM'
#!/usr/bin/env bash
exec corepack pnpm "$@"
SHIM
  chmod +x "$ROOT_DIR/.bin/pnpm"
  export PATH="$ROOT_DIR/.bin:$PATH"
  PNPM="pnpm"
else
  echo "pnpm is required. Install pnpm 9 or enable it with: corepack enable" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start the local PostgreSQL database." >&2
  exit 1
fi

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

set -a
. ./.env
set +a

wait_for_postgres() {
  echo "Waiting for PostgreSQL to accept connections..."

  for _attempt in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-agentshield}" -d "${POSTGRES_DB:-agentshield}" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  echo "PostgreSQL did not become ready within 30 seconds." >&2
  exit 1
}

echo "Starting PostgreSQL..."
docker compose up -d postgres
wait_for_postgres

echo "Installing dependencies..."
$PNPM install

echo "Generating Prisma client..."
$PNPM db:generate

if [ -d "prisma/migrations" ] && [ -n "$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -print -quit)" ]; then
  echo "Applying Prisma migrations..."
  $PNPM prisma migrate deploy
else
  echo "No Prisma migrations found; syncing schema with prisma db push for local demo setup..."
  $PNPM db:push
fi

echo "Starting API, durable scan worker, and web dashboard..."
$PNPM dev &
DEV_PID=$!
$PNPM --filter @agentshield/api dev:worker &
WORKER_PID=$!

cleanup() {
  echo "Stopping local dev processes..."
  kill "$DEV_PID" >/dev/null 2>&1 || true
  kill "$WORKER_PID" >/dev/null 2>&1 || true
}

trap cleanup INT TERM EXIT
wait "$DEV_PID"
