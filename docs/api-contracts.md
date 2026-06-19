# API Contracts

This document covers the primary demo scan endpoints exposed by `apps/api`. All request parameters and bodies are validated with Zod where applicable, and API errors use stable JSON shapes.

## `POST /api/scans/run-demo`

Runs the deterministic demo scan against `examples/vulnerable-repo`.

### Request

No request body is required.

```json
{}
```

### Success Response

Status: `201 Created`

```json
{
  "scanId": "clxscan0001demo"
}
```

### Operational Behavior

- Creates a `Scan` record with status `RUNNING`.
- Writes a `SCAN_CREATED` audit event.
- Runs the scanner package against the local vulnerable demo repository.
- Evaluates findings with the policy engine.
- Generates remediation only for `BLOCK` and `REQUIRE_APPROVAL` policy decisions.
- Creates pending approvals for `REQUIRE_APPROVAL` decisions.
- Persists findings, dependencies, policy decisions, remediation, approvals, and completion audit data.
- Marks the scan as `COMPLETED` or `FAILED`.

### Error Response

Status: `500 Internal Server Error`

```json
{
  "error": "INTERNAL_SERVER_ERROR",
  "message": "An unexpected error occurred."
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
