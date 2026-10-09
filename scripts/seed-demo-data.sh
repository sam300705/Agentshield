#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install pnpm 9 or enable it with corepack." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to reset the local PostgreSQL database." >&2
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

echo "Generating Prisma client..."
pnpm db:generate

if [ -d "prisma/migrations" ] && [ -n "$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -print -quit)" ]; then
  echo "Resetting database with Prisma migrations..."
  pnpm prisma migrate reset --force --skip-seed
else
  echo "No Prisma migrations found; force-resetting schema with prisma db push..."
  pnpm prisma db push --force-reset
fi

echo "Seeding deterministic demo data..."
pnpm db:seed

echo "Demo database reset complete."
