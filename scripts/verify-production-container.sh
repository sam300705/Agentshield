#!/usr/bin/env bash
set -euo pipefail
# Only disposable CI infrastructure. Never point this script at a production database.
task_tmp=$(mktemp -d)
fixture_pid=''
runtime_security=(--read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=1g)
cleanup() {
  result=$?
  if test "$result" -ne 0; then
    for container in agentshield-ops-api-a agentshield-ops-api-b agentshield-ops-worker; do
      docker logs --tail 40 "$container" 2>&1 || true
    done
  fi
  if test -n "$fixture_pid"; then kill "$fixture_pid" 2>/dev/null || true; fi
  docker rm -f agentshield-ops-api-a agentshield-ops-api-b agentshield-ops-worker agentshield-ops-scan-a agentshield-ops-scan-b agentshield-ops-db agentshield-ops-redis >/dev/null 2>&1 || true
  rm -rf "$task_tmp"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$task_tmp/tls.key" -out "$task_tmp/tls.crt" -days 1 -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' >/dev/null 2>&1
openssl genpkey -algorithm ED25519 -out "$task_tmp/signing.key" >/dev/null 2>&1
node - "$task_tmp" <<'NODE'
const fs = require('node:fs');
const dir = process.argv[2];
const values = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://ops:disposable@127.0.0.1:5434/ops?sslmode=require&connection_limit=3&connect_timeout=3',
  DATABASE_URL_UNPOOLED: 'postgresql://ops:disposable@127.0.0.1:5434/ops?sslmode=require',
  CORS_ORIGIN: 'https://web.example.com', AUTH_MODE: 'oidc', DEMO_AUTH_ENABLED: 'false',
  OIDC_ISSUER: 'https://identity.example.com', OIDC_AUDIENCE: 'api', OIDC_JWKS_URL: 'https://identity.example.com/keys',
  REDIS_REST_URL: 'https://127.0.0.1:9443', REDIS_REST_TOKEN: 'disposable', RATE_LIMIT_MAX: '2',
  RECEIPT_SIGNING_REQUIRED: 'true', RECEIPT_SIGNING_KEY_ID: 'ci-disposable',
  RECEIPT_SIGNING_PRIVATE_KEY: fs.readFileSync(`${dir}/signing.key`, 'utf8').trim().replaceAll('\n', '\\n'),
  NODE_EXTRA_CA_CERTS: '/test-ca.crt',
};
fs.writeFileSync(`${dir}/runtime.env`, Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n'), {mode:0o600});
NODE
docker build --target runtime -t agentshield:ops .
docker build --target migrations -t agentshield:ops-migrations .
docker run -d --name agentshield-ops-db --network host -e POSTGRES_USER=ops -e POSTGRES_PASSWORD=disposable -e POSTGRES_DB=ops -v "$task_tmp/tls.key:/fixtures/tls.key:ro" -v "$task_tmp/tls.crt:/fixtures/tls.crt:ro" postgres:16-alpine sh -c 'cp /fixtures/tls.key /tmp/server.key; cp /fixtures/tls.crt /tmp/server.crt; chown postgres:postgres /tmp/server.key /tmp/server.crt; chmod 600 /tmp/server.key; exec docker-entrypoint.sh postgres -p 5434 -c ssl=on -c ssl_key_file=/tmp/server.key -c ssl_cert_file=/tmp/server.crt' >/dev/null
for attempt in $(seq 1 30); do
  if docker exec agentshield-ops-db pg_isready -U ops -p 5434 >/dev/null; then break; fi
  sleep 1
done
docker run --rm --network host --env-file "$task_tmp/runtime.env" agentshield:ops-migrations >/dev/null
docker run -d --name agentshield-ops-redis --network host redis:7.4-alpine redis-server --port 6380 >/dev/null
# Adapter invokes redis-cli inside the fixture container on its configured port.
node scripts/production-redis-fixture.mjs "$task_tmp/tls.key" "$task_tmp/tls.crt" &
fixture_pid=$!
for instance in a b; do
  port=3001
  if test "$instance" = b; then port=3002; fi
  docker run "${runtime_security[@]}" -d --name "agentshield-ops-api-$instance" --network host --env-file "$task_tmp/runtime.env" -e PORT="$port" -v "$task_tmp/tls.crt:/test-ca.crt:ro" agentshield:ops >/dev/null
done
for port in 3001 3002; do
  ready=0
  for attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/health/ready" >/dev/null; then ready=1; break; fi
    sleep 1
  done
  test "$ready" -eq 1
done
# Same IP budget is shared by both actual API processes; missing auth stays fail-closed.
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/repositories)" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/api/v1/repositories)" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/v1/repositories)" = 429
docker run "${runtime_security[@]}" --rm --network host --env-file "$task_tmp/runtime.env" -v "$PWD/scripts/production-scan-fixture.mjs:/test/scan.mjs:ro" agentshield:ops node /test/scan.mjs prepare
for instance in a b; do
  docker run "${runtime_security[@]}" -d --name "agentshield-ops-scan-$instance" --network host --env-file "$task_tmp/runtime.env" -v "$PWD/scripts/production-scan-fixture.mjs:/test/scan.mjs:ro" -v "$PWD/examples/vulnerable-repo:/fixture:ro" agentshield:ops node /test/scan.mjs work >/dev/null
done
for instance in a b; do
  test "$(docker wait "agentshield-ops-scan-$instance")" = 0
done
docker run "${runtime_security[@]}" --rm --network host --env-file "$task_tmp/runtime.env" -v "$PWD/scripts/production-scan-fixture.mjs:/test/scan.mjs:ro" agentshield:ops node /test/scan.mjs verify
docker run "${runtime_security[@]}" -d --name agentshield-ops-worker --network host --env-file "$task_tmp/runtime.env" agentshield:ops node apps/api/dist/worker.js >/dev/null
sleep 2
docker exec agentshield-ops-worker node apps/api/dist/workerProbe.js
docker stop --time 120 agentshield-ops-worker agentshield-ops-api-a agentshield-ops-api-b >/dev/null
for container in agentshield-ops-worker agentshield-ops-api-a agentshield-ops-api-b; do
  test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0
done
printf 'PASS: fresh migrations, production config, nonroot API replicas, shared Redis, worker probe and graceful stop\n'
