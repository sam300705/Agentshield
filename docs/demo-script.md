# Demo Script

This is a three-minute technical interview walkthrough. Start with the API, dashboard, and PostgreSQL already running through `./scripts/run-local.sh`.

## 0:00-0:20 - Position The Problem

Open `http://localhost:5173`.

Say: "AgentShield is a TypeScript Policy-as-Code platform for AI coding agent output. The risk is that agents can now edit code, dependency manifests, Dockerfiles, Kubernetes YAML, and workflow logs faster than human reviewers can manually inspect them."

Point to the dashboard cards: `Total Scans`, `Total Findings`, `Pending Approvals`, and `Platform Risk Score`.

## 0:20-0:45 - Run The Demo Scan

Click `Run Demo Scan`.

Say: "This button calls `POST /api/scans/run-demo`. The API creates a scan, runs deterministic static scanners against `examples/vulnerable-repo`, evaluates declarative policy rules, generates eligible remediation, and persists the result in PostgreSQL."

After navigation, confirm that the scan results page shows the repository name, finding count, and SBOM item count.

## 0:45-1:20 - Explain Findings And Policy-as-Code

On the `Findings` tab, point to the severity and decision columns.

Click a critical secret finding such as `High-confidence AWS access key id detected` or `High-confidence AWS secret access key detected`.

Say: "The scanner produced evidence, but it did not decide business impact. The policy engine mapped this finding to a versioned rule such as `secret.critical.block`, which is why the decision is `BLOCK`. This separation keeps scanner evidence factual and policy decisions auditable."

Point to the evidence panel and note that matched values are redacted.

## 1:20-1:55 - Show Deterministic Remediation

Scroll to `Remediation`.

Say: "Remediation is deterministic in v1. AgentShield does not ask an LLM to invent fix text. It selects a template based on finding category and evidence, then creates an explanation, PR comment, and fix suggestion. That makes the output reproducible and reviewable."

Point out that detailed remediation appears for blocking and approval-required decisions, not for ordinary warnings.

## 1:55-2:20 - Show SBOM Inventory Boundary

Click the `Scan results` link to return to the scan page.

Click `SBOM Inventory`.

Say: "Dependency inspection is deliberately framed as SBOM inventory. It records package names, versions, scopes, manifests, and package URLs. It does not claim to be a full CVE vulnerability scanner in v1."

Point to wildcard or `latest` versions if present and explain that they represent inventory drift.

## 2:20-2:45 - Show Human Approval Workflow

Click `Approvals` in the sidebar.

Click `Review finding` for a pending approval, preferably an AI-agent workflow or Kubernetes hostPath finding.

Say: "Approval-required findings are routed to humans. This is where platform owners can review risky agent behavior such as remote script execution, `.env` access, hostPath mounts, or privilege escalation before merge."

Return to `Approvals`, then click `Reject` on one approval if you want to demonstrate auditability. Otherwise leave the queue intact.

## 2:45-3:00 - Close With Architecture

Click `Audit Trail`.

Say: "The architecture is intentionally enterprise-shaped: shared Zod contracts, deterministic scanners, declarative policy rules, stored rule snapshots, Prisma-backed audit records, and an operational dashboard. The future path is to promote the scanner into a concurrent CLI and the policy engine into a scalable backend service."

End by naming the core design choice: "For v1, determinism beats novelty. The system is built to be explainable, testable, and auditable."
