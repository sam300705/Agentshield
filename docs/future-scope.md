# Future Scope

AgentShield v1 demonstrates the core architecture: deterministic scanning, declarative policy evaluation, remediation templates, API orchestration, PostgreSQL persistence, and an operational dashboard. The enterprise roadmap should preserve that auditability while scaling the system across large repositories, many teams, and regulated workflows.

## Roadmap Principles

- Keep evidence collection separate from policy decisions.
- Keep policy behavior explicit, versioned, and reviewable.
- Preserve deterministic results for the same inputs.
- Treat audit history as immutable security evidence.
- Add scale through well-defined execution boundaries, not through ad hoc coupling.

## Scanner Roadmap: Scaling the CLI

The `packages/scanner` module now provides bounded walking, deterministic CI exit codes, SARIF and JSONL output, policy selection, timeouts, binary detection, and ignore controls. The next scaling work is:

Planned capabilities:

- Concurrent file walking with bounded worker pools and backpressure.
- Scanner plugin interface for secrets, Dockerfiles, Kubernetes, dependencies, IaC, CI workflows, and agent logs.
- Incremental scanning based on changed files, content hashes, and repository metadata.
- Optional worker-thread execution for CPU-heavy scanners such as entropy analysis.
- OpenTelemetry traces and structured logs for CI observability.

The CLI should remain evidence-focused. It should emit findings and dependency records without embedding business approval logic directly into scanner code.

## Policy Engine Roadmap: Scaling the Service

The policy engine now supports immutable rule snapshots, condition traces, versioned bundles, deterministic historical simulation, attack-graph derivation, integrity verification, and security receipts. The next scale-oriented work is:

Planned service design:

- Object-oriented domain model with `PolicyBundle`, `PolicyRule`, `Condition`, `Decision`, `EvaluationContext`, and `EvaluationResult` abstractions.
- Rule compilation and indexing so category, severity, and evidence-field filters can be evaluated efficiently at scale.
- Batch evaluation APIs for thousands of findings per scan.
- Horizontal scaling behind a queue or workflow engine for high-volume CI integrations.
- Strict compatibility guarantees for stored historical decisions.

The service should use object-oriented design where it clarifies policy concepts and lifecycle management. The goal is not ceremony; the goal is maintainable rule execution under enterprise scale.

## Enterprise Platform Capabilities

- Production identity-provider authentication and SSO on top of the current role/permission adapter.
- Required-check configuration and GitHub App installation on top of the committed Actions/SARIF workflow.
- Secret manager integrations for validation, rotation workflows, and incident handoff.
- CVE and exploitability intelligence as a separate dependency-risk service layered on top of SBOM inventory.
- Organization dashboards with risk trends, policy adoption, mean time to remediation, and approval aging.
- Audit export to SIEM platforms and long-term compliance archives.
- Database row-level security, retention jobs, and configurable redaction profiles on top of the tenant-aware schema.
- Webhook and ticketing integrations for Jira, Linear, Slack, and incident response workflows.
- Full policy editor, schema-assisted tests, and mandatory peer review on top of the current studio and time-machine preview.

## Advanced AI Integration Path

LLMs can be introduced after deterministic foundations are trusted. Appropriate Phase 9+ use cases include summarizing findings for executives, drafting contextual remediation plans from approved templates, clustering related risks, and explaining policy changes. LLM output should remain advisory unless backed by deterministic evidence and human approval.
