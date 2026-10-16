# API Contracts

This document covers the primary demo scan endpoints exposed by `apps/api`. All request parameters and bodies are validated with Zod where applicable, and API errors use stable JSON shapes.

## `POST /api/scans/run-demo`

Queues the deterministic demo scan against `examples/vulnerable-repo`. Requires authenticated `scan:run` permission. An optional `Idempotency-Key` header must contain 8–128 safe identifier characters; otherwise the server derives a key from the request correlation ID.

### Request

No request body is required.

```json
{}
```

### Success Response

Status: `202 Accepted`

```json
{
  "scanId": "clxscan0001demo",
  "jobId": "job0001demo",
  "status": "QUEUED",
  "correlationId": "request0001"
}
```

### Operational Behavior

- Atomically creates the queued scan/job and attributed admission audit record, or returns the existing scoped job for an idempotent replay. Its status may already have advanced.
- Returns before scanning. The worker claims and executes the job with bounded retries.
- Poll `GET /api/v1/scans/:scanId/progress` for job status/progress. Read findings and SBOM when complete.
- Worker evaluates policy, generates eligible remediation, and transactionally persists evidence and completion history.
- Execution status and security gate are separate: a completed scan may still BLOCK or REQUIRE_APPROVAL.
- Cancellation, failures, and retry exhaustion remain explicit terminal/recovery states.

### Error Response

Status: `500 Internal Server Error`

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred.",
    "correlationId": "request0001"
  }
}
```

## `GET /api/scans/:scanId`

Returns a single scan summary by ID.

### Path Parameters

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `scanId`  | string | yes      | Unique scan identifier returned by `POST /api/scans/run-demo`. |

### Request

No request body is used.

```json
{}
```

### Success Response

Status: `200 OK`

```json
{
  "data": {
    "id": "clxscan0001demo",
    "repositoryName": "agentshield-vulnerable-demo-target",
    "repositoryUrl": "https://github.com/example/agentshield-vulnerable-demo-target",
    "branch": "main",
    "commitSha": null,
    "status": "COMPLETED",
    "metadata": {
      "source": "LOCAL_EXAMPLE",
      "targetPath": "../../examples/vulnerable-repo",
      "triggeredBy": "System",
      "labels": ["demo", "api-run"],
      "aggregateCounts": {
        "findings": {
          "total": 12,
          "critical": 5,
          "high": 5,
          "medium": 2,
          "low": 0
        },
        "policyDecisions": {
          "ALLOW": 0,
          "WARN": 2,
          "REQUIRE_APPROVAL": 4,
          "BLOCK": 6
        },
        "dependencies": 5,
        "remediations": 10,
        "approvals": 4
      }
    },
    "startedAt": "2026-06-17T10:00:00.000Z",
    "completedAt": "2026-06-17T10:00:02.000Z",
    "createdAt": "2026-06-17T10:00:00.000Z",
    "updatedAt": "2026-06-17T10:00:02.000Z",
    "_count": {
      "findings": 12,
      "dependencies": 5,
      "auditEvents": 2
    }
  }
}
```

### Not Found Response

Status: `404 Not Found`

```json
{
  "error": "SCAN_NOT_FOUND",
  "message": "Scan clxscan0001demo was not found."
}
```

### Validation Error Response

Status: `400 Bad Request`

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "issues": []
}
```

## Phase 1 repository admission

Authenticated, valid repository scan submissions return `503` with shared error code `REPOSITORY_SCANS_UNAVAILABLE` and correlation ID. No scan/job rows are created by this endpoint while the live repository worker is unqualified. Phase 3 owns activation. Nonrunning queued or retryable failed jobs cancel atomically into terminal `CANCELLED`; running cancellation is reconciled under the job row lock.

## Phase 1 tenant/actor-owned sessions

All lifecycle routes require authentication. Creation and closure require `scan:run`;
reading requires `scan:read`. The server derives organization and actor from its
verified request context. Bodies reject identity fields and unknown properties;
queries must be empty. IDs use 1–128 letters, digits, dots, underscores, colons or
hyphens; SDK paths additionally percent-encode validated identifiers.

- `POST /api/v1/agent/sessions`: body `{repositoryId, source, taskSummary,
idempotencyKey}`. The repository must belong to the authenticated tenant.
  Returns `{data: session}` with 201 on creation, 200 on exact replay. The key is
  scoped to tenant and actor; changed repository/source/task context returns 409
  `SESSION_IDEMPOTENCY_CONFLICT`. Replay never reopens a terminal session. Creation
  and its attributed audit event commit atomically. Display fields are bounded and
  sanitized; internal idempotency/context digests are not returned.
- `GET /api/v1/agent/sessions/:sessionId`: returns the owned session, including a
  terminal one. Foreign actor, foreign tenant and absent IDs all return 404
  `SESSION_NOT_FOUND` without exposing existence.
- `POST /api/v1/agent/sessions/:sessionId/close`: body `{}`. ACTIVE transitions to
  COMPLETED with a completion timestamp and atomic audit; terminal replay returns
  the existing terminal state without another closure event.

Creation serializes on the tenant/actor/key tuple. Closure, event ingestion,
server decision admission and new approval creation share the session advisory
transaction lock. Operations that obtain the lock before closure can commit before
it; operations that obtain it afterward cannot append events, issue new decisions,
or create new approvals. An admitted decision is not an external-action lock:
closure does not undo actions already completed or prevent a cooperative caller
from acting on a previously returned decision. The SDK is not runtime enforcement.

A gateway decision requiring approval, its required approval and both authoritative
audits now commit in one transaction under that session lock. Closure cannot fall
between decision persistence and approval creation. Either audit failure rolls the
whole admission back; an idempotency conflict creates no new decision audit.

## Scan coverage and receipt compatibility

New scans expose `metadata.coverage`; new canonical receipts include optional
`coverage`. CLI JSON, JSONL summaries, human output and SARIF run properties carry
it. `enumeratedFiles` counts observed regular file entries, including explicitly
excluded regular files. `inspectedFiles` counts admitted files receiving supported
checks; `unsupportedFiles` counts admitted files without a supported check.
`excludedEntries` counts excluded files, directories and nonregular entries, not
imagined files below unvisited directories. These are distinct observations, not
four disjoint buckets to sum together.

COMPLETE means supported static checks completed within the observed scope, not
proof of safety, all-language analysis, complete event capture or comprehensive
CVE detection. Unsupported/excluded entries yield PARTIAL. Historical records
without coverage display unavailable; their evidence is never backfilled. Limits
still fail closed, and checkout-controlled ignore files cannot relax authoritative
checks. Optional advisory enrichment retains its separate disabled/unavailable
status; coverage does not claim provider qualification.

New coverage includes optional `incompleteChecks`: the number of applicable checks
that could not finish parsing, counted once per affected YAML file/check. YAML
errors, warnings, conversion failures and unrendered template syntax yield PARTIAL
even if secret text inspection completed. Parser source/messages are not exported.
Older records without this field have unavailable parser completion diagnostics;
do not infer zero. The field propagates through CLI, metadata, console and receipts.

Coverage participates in new canonical hashes and Ed25519 signatures when present.
Its absence preserves legacy payload/hash behavior. New unsigned receipts retain
their canonical payload in the existing `signedPayload` storage column, but only
non-null signature, algorithm and key ID produce a signed envelope. A retained
payload is not a signature. Integrity/signature verification does not prove safety
or that all events were captured; reader services need no private signing key.

Dependency persistence consolidates identical public identities after redaction:
`(scanId, packageName, version, manifestPath)`. Production occurrence wins scope;
conflicting nonproduction scopes become UNKNOWN. Counts reflect persisted rows,
and advisory links use persisted identities. No credential hash, reversible
encoding or secret-derived discriminator is added, avoiding low-entropy secret
hash disclosure. Analysis/enrichment uses original inventory only in memory.

Consolidated metadata selects a production source first, then stable sanitized
source semantics; generated IDs only break ties between identical public content.
`dependencyFields` aggregates observed section names. A production row cannot
randomly inherit development-section metadata from UUID ordering.

## Phase 2 foundation integration

See [current scope and verification](phase2-integration-handoff.md). Audit listing
requires `audit:read` (reviewer, policy administrator or organization administrator).
Demo scan and control-plane endpoints require an explicit authenticated demo actor;
OIDC actors cannot use illustrative data endpoints. Unknown approval review fields
and unknown audit/approval pagination fields are rejected. Existing parser status
codes 400/413/415 are preserved; validation issues omit raw rejected values.

A reviewed finding approval returns 409 on repeat rather than a misleading 404.
Repository submission still returns 503 and creates no work until Phase 3 activation.
The internal repository enqueue primitive rejects changed actor, trigger, action
context or options on key replay; new keys use unambiguous tenant/key tuples, with
tenant-filtered legacy lookup. No new execution or approval-consumption endpoint is
introduced by the foundation merge. Existing SDK authorization remains cooperative.
