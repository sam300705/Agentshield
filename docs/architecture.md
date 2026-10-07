# Architecture

AgentShield is organized as a TypeScript monorepo because the most important engineering boundary in v1 is contract integrity, not service distribution. The scanner, policy engine, remediation generator, API, and dashboard all depend on shared Zod schemas, which keeps runtime validation and TypeScript inference aligned across the stack.

## Monorepo Design Decisions

The repository separates deployable applications from reusable domain packages:

- `apps/api` owns HTTP orchestration, request validation, database persistence, and route-level error shapes.
- `apps/web-dashboard` owns the operator-facing React dashboard.
- `packages/schemas` owns shared Zod schemas and inferred TypeScript types for scans, findings, policy decisions, remediation, approvals, audit events, dependencies, and JSON values.
- `packages/scanner` owns deterministic repository inspection and SBOM-style dependency inventory.
- `packages/policy-engine` owns declarative Policy-as-Code evaluation.
- `packages/remediation` owns deterministic fix guidance and PR-comment templates.
- `prisma` owns database schema, seed data, and persistence model evolution.

This structure allows each package to be tested and reasoned about independently while still preserving end-to-end type safety. It also demonstrates an enterprise-style architecture without prematurely introducing distributed systems complexity.

## Separation of Concerns

### Scanner

The scanner package collects evidence. It walks a target repository and invokes specialized scanners for likely secrets, Dockerfiles, Kubernetes manifests, AI-agent workflow logs, and `package.json` dependency inventory. Scanner output is intentionally factual: it produces findings and dependency records, not business decisions.

### Policy Engine

The policy engine turns findings into decisions. Policy behavior is represented as declarative rule dictionaries with explicit IDs, versions, targets, conditions, decisions, remediation eligibility, rationales, and tags. Evaluation is deterministic: the same finding input and rule set produce the same policy decision.

### Remediation

The remediation package turns blocking or approval-required findings into deterministic guidance. It does not call an LLM in v1. Templates are selected from finding category and evidence so remediation remains auditable, reproducible, and scoped to the specific risk.

### API

The API composes the packages into an operational workflow. `POST /api/scans/run-demo` explicitly queues a demo scan and returns 202. The worker scans `examples/vulnerable-repo`, evaluates policy, generates eligible remediation, and commits results durably.

### Dashboard

The dashboard presents operational state: Platform Risk Score, total findings, pending approvals, latest scan metrics, findings, SBOM inventory, remediation details, and audit events. It is intentionally dense and workflow-oriented rather than marketing-oriented.

## Durable backend and scan flow

PostgreSQL through the generated Prisma client is authoritative. The API and worker are separate processes; their only scan/job coordination is through the database. There is no runtime in-memory substitute. JWKS caching and request rate counters are transient infrastructure state, not domain persistence.

1. The API validates the authenticated actor, role permission, repository tenant ownership, and strict request schema. Enqueue creates the scan, job, and `SCAN_CREATED` audit in one transaction. Concurrent requests with the same organization and idempotency key converge on one job; conflicting request content returns 409. The scope key uses an unambiguous JSON tuple.
2. A worker conditionally claims an eligible job and starts its scan in one short transaction. Each claim has a unique ownership token. Attempts increment only when that claim succeeds.
3. Workspace preparation, scanning, optional advisory lookup, policy evaluation, and remediation generation happen outside the write transaction.
4. Completion first locks/fences the owned, uncancelled, unexpired job. Evidence, dependencies, decisions, eligible remediation, requested approvals, receipt, audit, and both terminal states then commit together. A failed receipt or database write rolls back every result.
5. Failure records an opaque diagnostic code, attempts, bounded retry time, and audit. An exhausted job is dead-lettered and is never selected again. Cancellation completes queued/retry jobs immediately; running jobs receive a cancellation request that blocks result publication.

### Persisted ownership and constraints

| Entity                                                                                                 | Ownership / durability rule                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization, User, Membership                                                                         | Durable provisioning records; trusted OIDC issuer supplies authenticated tenant/role claims. Membership administration is not exposed by this API.                                                                                                |
| Repository, GitHubInstallation                                                                         | Required organization; owner-consistent installation reference, tenant-scoped service lookup.                                                                                                                                                     |
| Scan, ScanJob                                                                                          | Scan carries tenant; job derives it through scan. One job per scan and unique scoped idempotency key. Attempts and progress have database bounds.                                                                                                 |
| Finding, PolicyDecision, Remediation, Approval                                                         | Tenant derives through scan. Findings have scan-prefixed unique fingerprints. Each finding has at most one decision/remediation/approval. Completed scanner results always include decisions; remediation and approval are conditional on policy. |
| Dependency, Advisory                                                                                   | Scan-scoped dependency identity; advisory records retain their existing organization ownership and optional scan/dependency references. No new advisory provider behavior.                                                                        |
| AgentSession, AgentEvent, AgentApproval                                                                | Session belongs to tenant/repository; parent-owner constraints guard approval/session links. Event sequence and idempotency are unique per session.                                                                                               |
| SecurityReceipt                                                                                        | Unique per scan; owner scoped through scan. Evidence is redacted before hashing/signing. Blank optional signing settings disable signing; supplying only one setting fails closed.                                                                |
| AuditEvent                                                                                             | Tenant, actor, action, resource, correlation, safe metadata, timestamp. No update/delete endpoint. Seed preserves history.                                                                                                                        |
| PolicyBundle/Version, Simulation/Decision, RiskNode/Edge, EvidenceArtifact, Integration, AgentBaseline | Existing durable schema models; no newly exposed write endpoint or provider activation in Phase 2.                                                                                                                                                |

Legacy nullable scan/audit tenant fields remain compatible; tenantless rows are never returned by actor-scoped API reads. SQL owner-consistency foreign keys supplement Prisma single-column relations. Check constraints and these additional foreign keys are maintained by committed migrations; they must be preserved in future migrations. An existing inconsistent database must be reviewed before migration rather than silently assigning rows to tenants.

### Authentication and permissions

OIDC JWT signature, issuer, audience, subject, recognized role, and tenant claims are verified before creating `RequestActor`. Production startup refuses demo authentication or missing OIDC settings. Invalid or malformed Authorization headers cannot fall back to demo. Demo actor lookup accepts only own configured keys, and illustrative endpoints require `actor.demo`.

| Role                       | Permissions                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| VIEWER                     | Read scans, findings, SBOM, receipts, repositories                                           |
| DEVELOPER                  | Viewer reads; create/cancel scans; agent event/request actions; policy simulation permission |
| SECURITY_REVIEWER          | Viewer reads; independent approval review; audit read; simulation permission                 |
| POLICY_ADMINISTRATOR       | Viewer reads; policy manage/simulate permissions; audit read                                 |
| ORGANIZATION_ADMINISTRATOR | All existing permissions, including organization management and audit read                   |

Policy/organization management permissions do not imply newly exposed admin endpoints. Deterministic remediation is created by the scan workflow; no automatic patch execution or separate remediation mutation API is introduced. Audit reads have their own permission. Agent request bodies must match both authenticated actor and tenant.

### Approval and worker states

Both approval types permit only `PENDING -> APPROVED` or `PENDING -> REJECTED`. Conditional update and corresponding audit share one transaction; a second/concurrent decision returns 409, and the requester cannot review their own request. Reviewed actor/time and sanitized reason are persisted.

Scans/jobs follow `QUEUED -> RUNNING -> COMPLETED`, or `RUNNING -> FAILED` with eligible retries, or active state to `CANCELLED`. `FAILED` is retryable only while attempts remain and the job has no dead-letter marker. Terminal completed/cancelled scans cannot restart. Retry delay uses bounded exponential backoff with jitter. A lease is five minutes; heartbeat renewal occurs every one-third lease and requires the current unexpired ownership token. Recovery rechecks expiry inside each transaction, handles at most 100 jobs per pass, and records exhaustion/cancellation. Older workers cannot publish after recovery even when they resume later.

### Evidence and API boundaries

Known credential formats and sensitive evidence properties are redacted before persistence and receipt hashing. Review reasons and event text/resources are sanitized. Database query/error payload logging is disabled; API/worker failures use opaque messages rather than arbitrary exception contents. Validation errors return only bounded code/path/generic-message issues. Lists have limits up to 100 and bounded pages; repository listing is now paginated. Stable 400/401/403/404/409/429/500 envelopes retain correlation IDs.

`pnpm test:backend-security` exercises real PostgreSQL and real JWT/JWKS verification, including concurrent claims/reviews, tenant access, retries, overlapping recovery, cancellation, rollback, audit, and separate-client persistence reads. It creates and removes only uniquely named synthetic tenants and does not reset existing data. Existing unit, gateway, GitHub lifecycle, scanner/SARIF and browser checks remain CI gates.

## Phase 3 provider execution

GitHub webhook acceptance and enqueue share a transaction. Installations establish tenant
ownership; immutable numeric repository IDs and selected-access state authorize work. Jobs carry
the accepted full commit SHA and installation ID. The production worker resolves that mapping,
checks the remote numeric identity and extracts only that SHA into an isolated bounded workspace.
Existing scanner/policy/evidence persistence and attempt fencing remain authoritative.
`GitHubCheckPublication` independently schedules queued/in-progress/completed output and safe
publication retries under a per-scan advisory lock. Provider faults preserve completed scan data.
See [the GitHub architecture and owner setup](./github-app.md) for limits, permissions, external-ID
reconciliation, provider caveats and the blocked real-provider gate.
