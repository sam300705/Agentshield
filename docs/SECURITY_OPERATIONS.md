# Security Operations Guide

This guide describes the operational controls expected around an AgentShield deployment. It is an engineering baseline, not a certification, legal opinion, or guarantee of compliance. Operators must adapt it to their environment, contracts, and applicable law.

## Data classification

AgentShield should be operated as if repository content, findings, dependency metadata, audit records, and correlation identifiers are confidential engineering data. The scanner is designed to redact high-confidence secret values before persistence, but operators must still treat inputs and outputs as sensitive. The current demo and test fixtures are synthetic and must not be replaced with customer, hospital, medical, personal, or production repository data without a reviewed retention and access policy.

| Data class   | Examples                                                                                 | Required handling                                                                             |
| ------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Public       | Source code, documentation, synthetic examples, published scanner rules                  | Review before publication; do not include runtime credentials.                                |
| Internal     | Operational logs, queue state, non-sensitive scan metadata, deployment configuration     | Restrict access to operators and retain only as needed.                                       |
| Confidential | Findings, dependency inventories, audit events, policy decisions, repository identifiers | Enforce tenant and role boundaries, encrypt in transit and at rest, and avoid public exports. |
| Restricted   | Credentials, tokens, private keys, raw repository files, unredacted evidence             | Do not persist in logs or reports; inject through a secret manager and rotate after exposure. |

## Retention and deletion

Define retention periods before connecting customer data. The application should retain only the derived records needed for the approved research or security workflow. Raw repository files and secret values must not be retained by the scanner. Deletion operations should remove eligible database records and associated objects atomically as far as the storage provider permits, record a privacy-safe audit event, and avoid deleting immutable audit evidence without an explicit retention decision.

A production operator should document the retention period for scans, findings, reports, artifacts, audit events, failed jobs, and backups. The current repository does not claim to provide a complete cross-provider deletion guarantee; verify provider behavior and backups before making a customer-facing commitment.

## Secrets and access

Use platform-managed secret references for database URLs, OIDC values, signing material, and external integrations. Do not put secrets in Git, issue comments, screenshots, CI summaries, browser local storage, URL query strings, or application logs. Restrict the runtime database role, separate migration credentials from runtime credentials where possible, and rotate values after suspected exposure. Production demo authentication must remain disabled.

## Backups and restore

The deployment operator must enable and verify backups for the managed PostgreSQL service and any object storage used for reports or artifacts. Record the retention window, recovery point objective, recovery time objective, encryption configuration, and restore owner. Perform a restore rehearsal using synthetic data before describing the service as recoverable. Keep backups isolated from application deletion credentials and do not assume that a provider's default backup settings satisfy a customer's retention requirement.

The safe database change procedure is to review a Prisma migration, apply it with `pnpm db:deploy`, verify readiness and representative queries, and retain the previous application image for rollback. Do not use `pnpm db:push` for production schema changes.

## Audit and observability

Use structured logs with timestamps, service name, severity, request or job correlation ID, route or operation, outcome, and bounded error code. Authentication and authorization failures may be counted by code and tenant-safe context, but logs must not contain tokens, cookies, signed URLs, raw repository content, secret values, or unnecessary personal identifiers.

At minimum, monitor API liveness and readiness, request error rates, authentication failures, authorization denials, rate-limit responses, queue depth, job age, retry counts, stale-lock recovery, permanent failures, migration status, and artifact deletion failures. Alert thresholds must be calibrated using observed baseline traffic; initial recommendations are a sustained 5xx rate above 5% for 5 minutes, a queue age above 10 minutes, or repeated permanent job failures. These thresholds are starting points, not measured service-level objectives.

The repository does not send telemetry to an external service by default. Add error tracking or metrics exporters only through explicit configuration, privacy review, and documented consent. The current in-memory rate limiter is per API instance and is not a substitute for an edge or distributed control in a multi-replica deployment.

## Receipt operations

Use `pnpm --silent receipt:sign -- --receipt <receipt.json> --private-key <private-key.pem> --key-id <key-id>` when piping signed JSON to another command; the silent flag prevents package-manager status text from entering the JSON stream. `pnpm receipt:verify -- --receipt <signed.json> --public-key <public-key.pem>` verifies the result without requiring a private key. The signing command reads the private key from a local file and emits only the signed receipt; do not pass private keys on the command line or commit generated key material.

## Incident response

When a credential or restricted artifact is exposed, stop further publication, revoke or rotate the credential, preserve sanitized evidence, identify affected tenants and time windows, and document the incident. When a scan worker behaves incorrectly, pause new work if necessary, inspect bounded failure records and queue locks, redeploy a known-good image, and verify that no raw input was written to logs. When data isolation is suspected, restrict access and begin an authorized investigation before deleting evidence.

Follow [`SECURITY.md`](../SECURITY.md) for vulnerability reporting. Do not publish incident details, customer data, or exploit material in public issues.

## Rollback and change control

Keep application images immutable and record the commit, migration state, configuration version, and deployment revision. Roll back application code only when the database schema remains compatible; otherwise use a forward migration or restore procedure approved by the operator. Stop or disable resources rather than deleting data during initial containment. Destructive deletion, DNS changes, billing changes, and production model or policy promotion require explicit owner approval.

## Repository branch protection recommendations

The repository currently has no claim of configured branch protection in this document. A repository administrator should enable the following controls after confirming the team identities and required checks:

| Control                  | Recommendation                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Main branch changes      | Require pull requests; prohibit direct pushes and force-pushes.                                                                          |
| Reviews                  | Require at least one approving review, and require security-owner review for authentication, scanner, migration, and deployment changes. |
| Status checks            | Require the CI quality job and deployment checks to pass before merge.                                                                   |
| Conversation and history | Require resolved review conversations and keep linear or protected history according to team policy.                                     |
| Code ownership           | Add verified users or teams to `.github/CODEOWNERS.example`; do not guess identities.                                                    |
| Secrets and actions      | Restrict workflow permissions, review third-party actions, and enable secret scanning and dependency alerts where available.             |

These are recommendations only. No branch-protection setting has been changed as part of this repository work.
