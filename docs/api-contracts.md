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
