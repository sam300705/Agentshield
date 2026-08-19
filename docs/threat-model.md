# Threat Model

## Security Objective

AgentShield protects pre-merge and review workflows where AI coding agents may introduce risky code, unsafe infrastructure, suspicious automation behavior, or dependency drift. The primary goal is not to replace human review; it is to make high-risk agent output visible, auditable, and policy-controlled before merge.

## Assets Protected

- Source code and configuration files.
- Cloud credentials, API tokens, SSH material, and local `.env` values.
- CI/CD pipelines and build environments.
- Container image build definitions.
- Kubernetes workload manifests and cluster security posture.
- Dependency inventory and package provenance signals.
- Policy decisions, approvals, remediation records, and audit events.
- Engineering leadership visibility into platform risk posture.

## Threat Actors

- Malicious dependency maintainers introducing risky install behavior or supply-chain drift.
- Hallucinating AI coding agents that invent unsafe fixes, disable controls, or execute risky commands.
- Prompt-injected agents that read secrets, modify deployment manifests, or bypass tests.
- Compromised developer workstations or CI runners with access to repository context.
- Malicious insiders attempting to normalize risky infrastructure changes.
- External attackers who gain read access to source-controlled secrets or logs.
- Well-intentioned developers who approve agent output without enough security context.

## In-Scope Risks

- High-confidence hardcoded secrets in source-controlled text.
- Dockerfiles that use mutable base images, run as root, or pipe network content into a shell.
- Kubernetes manifests that enable privileged containers, privilege escalation, or hostPath mounts.
- AI-agent workflow logs that show `.env` reads, world-writable permissions, remote script execution, or SSH-material access.
- Dependency inventory drift captured through SBOM generation.
- Policy decisions that must block a merge or require human approval.
- Auditability of scan, decision, remediation, and approval activity.

## Security Controls

- Deterministic scanners with explicit finding categories and evidence.
- High-confidence regex patterns for secrets to reduce noisy false positives.
- Declarative policy rules with versioned IDs and stored rule snapshots.
- Stable decision categories: `ALLOW`, `WARN`, `REQUIRE_APPROVAL`, and `BLOCK`.
- Deterministic remediation templates for blocked and approval-required findings.
- PostgreSQL persistence for scans, findings, dependencies, policy decisions, remediation, approvals, and audit events.
- Dashboard visibility into Platform Risk Score and pending approvals.
- Redacted, hash-chained Agent Events with correlation and idempotency metadata.
- Deterministic causal graph derivation with confirmed/inferred edge labels.
- Server-side RBAC and approval separation of duties.
- Bounded repository traversal with symlink and path-escape safety.
- Durable, retry-bounded background scan jobs.
- Immutable policy simulations and tamper-evident Security Receipts.

## Explicit v1 Limitations

- Secret scanning relies on high-confidence regex patterns only; v1 does not perform entropy checks.
- Secret findings are redacted in evidence, but v1 does not validate, revoke, or rotate credentials.
- AI workflow logs are parsed deterministically by pattern matching rather than interpreted by an LLM.
- Dependency inspection is an SBOM generator, not a full CVE vulnerability scanner.
- Dockerfile and Kubernetes scanning are static checks only; v1 does not execute builds or run workloads.
- v1 does not provide runtime protection, admission control, sandboxing, or eBPF monitoring.
- The demo identity adapter is not production authentication; OIDC/SSO remains required.
- SARIF and a reusable workflow exist, but a GitHub App, ticketing, and secret-manager integrations require external authentication infrastructure.
- v1 remediation is template-driven and does not modify files automatically.
- v1 is designed as a local demo and architecture portfolio, not as a production SaaS deployment.

## Trust Boundaries

- The dashboard trusts the local API at `http://localhost:3001`.
- The API trusts PostgreSQL as the system of record.
- Scanner input is treated as untrusted repository content.
- Policy rules are trusted application configuration and must be reviewed like code.
- Audit events are append-oriented records intended to preserve security-relevant history.

## Abuse Cases To Discuss In Review

- An AI agent adds a hardcoded cloud credential to an environment template.
- An AI agent pipes a remote install script into `bash` inside a Dockerfile.
- A Kubernetes manifest grants privileged container access and host filesystem mounts.
- A dependency manifest introduces wildcard or `latest` dependency versions.
- A reviewer tries to approve a risky finding without remediation context.
