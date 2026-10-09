# Resume Bullets and Interview Talking Points

## Resume bullets

- Architected **AgentShield**, a TypeScript AI-agent security control plane combining a redacted event flight recorder, deterministic Policy-as-Code firewall, evidence-derived causal attack graphs, counterfactual policy simulation, and tamper-evident Security Receipts.
- Implemented bounded repository scanning with symlink/path-escape defenses, file and byte budgets, cancellation, high-confidence secret redaction, SBOM inventory, JSON/JSONL/SARIF output, and deterministic CI exit codes.
- Designed a multi-tenant Prisma/PostgreSQL domain model for organizations, repositories, agent sessions/events, durable scan jobs, versioned policy bundles, simulations, attack graphs, evidence artifacts, receipts, integrations, and behavior baselines.
- Built a PostgreSQL-backed worker boundary with idempotency, conditional job claims, cancellation, progress, structured failures, three-attempt retry limits, and capped exponential backoff.
- Enforced API-side RBAC across five roles and separation of duties for risky approvals; added correlation IDs, structured redacted errors, readiness checks, and operational job metrics.
- Delivered an accessible React security command center with deterministic scenario replay, command palette, global evidence search, synchronized timeline/graph views, Policy Time Machine, Approval Cockpit, receipt export, transparent behavior drift, responsive layouts, and reduced-motion support.
- Added deterministic tests for redaction, tamper detection, graph derivation, blast-radius scoring, receipt hashing, policy simulations/traces, scanner false-positive boundaries, remediation, RBAC, approval independence, and dashboard logic.

## Interview talking points

- **Why no LLM in the enforcement path?** Security gates must be reproducible. An LLM could later summarize evidence, but cannot override deterministic policy.
- **Why PostgreSQL for jobs?** It minimizes operational dependencies at demo scale while preserving durable semantics. The queue interface can move to BullMQ if contention measurements justify it.
- **What does the graph prove?** Stored order, resource references, and shared correlations. Inferred edges are explicitly not claims about intent.
- **What does a receipt prove?** The payload has not changed relative to its hash. It does not prove who created it unless a signing system is added.
- **How is tenant isolation enforced?** Organization ownership is first-class in the data model; production queries must scope by the resolved organization, not accept opaque IDs as authorization.
