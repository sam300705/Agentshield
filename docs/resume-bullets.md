# Resume Bullets

## High-Impact Resume Bullets

- Architected AgentShield, a TypeScript-first Policy-as-Code security platform for AI coding agent output, using pnpm workspaces, shared Zod contracts, Express APIs, Prisma/PostgreSQL persistence, and a React/Vite dashboard.
- Built deterministic static analysis modules for high-confidence secret detection, Dockerfile risk patterns, Kubernetes manifest misconfigurations, AI-agent workflow log inspection, and SBOM-style dependency inventory.
- Designed a declarative policy engine with versioned rule dictionaries, explicit `ALLOW`, `WARN`, `REQUIRE_APPROVAL`, and `BLOCK` decisions, stored rule snapshots, and reproducible evaluation semantics.
- Implemented deterministic remediation generation for high-risk findings, producing reviewable explanations, PR comments, and fix guidance without relying on non-auditable LLM output in v1.
- Delivered a full-stack operational dashboard with Platform Risk Score, pending approval queue, findings drilldowns, SBOM inventory, audit trail visibility, and TanStack Table powered scan-result views.

## Interview Talking Points: Deterministic v1 Over LLM v1

- Deterministic scanners and policy rules make every result reproducible, testable, and explainable, which is essential for security review and audit trails.
- LLM-generated remediation can be useful later, but v1 prioritizes bounded templates so the product never invents unsafe fixes or inconsistent explanations.
- The architecture keeps an LLM integration path open while first establishing trusted evidence, typed contracts, policy snapshots, and human approval workflows.
