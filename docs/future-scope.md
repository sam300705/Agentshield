# Future Scope

AgentShield v1 demonstrates the core architecture: deterministic scanning, declarative policy evaluation, remediation templates, API orchestration, PostgreSQL persistence, and an operational dashboard. The enterprise roadmap should preserve that auditability while scaling the system across large repositories, many teams, and regulated workflows.

## Roadmap Principles

- Keep evidence collection separate from policy decisions.
- Keep policy behavior explicit, versioned, and reviewable.
- Preserve deterministic results for the same inputs.
- Treat audit history as immutable security evidence.
- Add scale through well-defined execution boundaries, not through ad hoc coupling.

## Scanner Roadmap: Highly Concurrent CLI

The `packages/scanner` module should evolve into a production-grade CLI designed for large repositories and CI environments.

Planned capabilities:

- Concurrent file walking with bounded worker pools and backpressure.
- Scanner plugin interface for secrets, Dockerfiles, Kubernetes, dependencies, IaC, CI workflows, and agent logs.
- Incremental scanning based on changed files, content hashes, and repository metadata.
- SARIF output for GitHub code scanning and security tooling interoperability.
- JSONL streaming output for large result sets.
- Deterministic exit codes for CI gating, including separate codes for `BLOCK` and `REQUIRE_APPROVAL`.
- Configurable ignore files, allowlists, and policy bundle selection.
- Repository-size safeguards such as file size limits, binary detection, timeout budgets, and memory ceilings.
- Optional worker-thread execution for CPU-heavy scanners such as entropy analysis.
- OpenTelemetry traces and structured logs for CI observability.

The CLI should remain evidence-focused. It should emit findings and dependency records without embedding business approval logic directly into scanner code.

## Policy Engine Roadmap: Scalable Object-Oriented Service

The `packages/policy-engine` module should evolve into a robust backend service when policy execution needs to support many organizations, large rule sets, approval routing, and historical explainability.

Planned service design:

- Object-oriented domain model with `PolicyBundle`, `PolicyRule`, `Condition`, `Decision`, `EvaluationContext`, and `EvaluationResult` abstractions.
- Versioned policy bundles with promotion workflows across development, staging, and production.
- Rule compilation and indexing so category, severity, and evidence-field filters can be evaluated efficiently at scale.
- Batch evaluation APIs for thousands of findings per scan.
- Explainability APIs that return matched rule IDs, skipped rule reasons, condition-level traces, and rule snapshots.
- Policy simulation mode for testing new rules against historical scans before enforcement.
- Tenant-aware policy resolution for enterprise organizations and teams.
- Durable evaluation jobs for massive scans, including retry behavior and idempotency keys.
- Horizontal scaling behind a queue or workflow engine for high-volume CI integrations.
- Strict compatibility guarantees for stored historical decisions.

The service should use object-oriented design where it clarifies policy concepts and lifecycle management. The goal is not ceremony; the goal is maintainable rule execution under enterprise scale.

## Enterprise Platform Capabilities

- Authentication, SSO, RBAC, approval delegation, and separation-of-duty controls.
- GitHub pull request checks, annotations, SARIF upload, and required status integration.
- Secret manager integrations for validation, rotation workflows, and incident handoff.
- CVE and exploitability intelligence as a separate dependency-risk service layered on top of SBOM inventory.
- Organization dashboards with risk trends, policy adoption, mean time to remediation, and approval aging.
- Audit export to SIEM platforms and long-term compliance archives.
- Multi-tenant data isolation, retention policies, and configurable evidence redaction.
- Webhook and ticketing integrations for Jira, Linear, Slack, and incident response workflows.
- Policy authoring UI with tests, dry-run previews, and mandatory peer review.

## Advanced AI Integration Path

LLMs can be introduced after deterministic foundations are trusted. Appropriate Phase 9+ use cases include summarizing findings for executives, drafting contextual remediation plans from approved templates, clustering related risks, and explaining policy changes. LLM output should remain advisory unless backed by deterministic evidence and human approval.
