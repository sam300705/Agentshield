# AgentShield AI Coding Instructions

These instructions are mandatory for AI coding agents working in this repository.

## Project Posture

AgentShield is a serious security platform engineering project. Treat it like software that would be reviewed by security engineers, platform engineers, and engineering leaders. Favor explicit contracts, auditable behavior, deterministic outputs, and boring reliability over novelty.

## Phase Discipline

The project is currently in **Phase 8+: Security Control Plane**.

- Zod schemas, Prisma migrations, scanner and CLI logic, policy evaluation and simulation,
  remediation, API and worker boundaries, RBAC, and dashboard implementation are allowed.
- Do not introduce real LLM calls in v1.
- Keep deterministic evidence and policy authoritative. Any future LLM integration must be
  optional, advisory, explicitly configured, and excluded from the offline demo path.

## Architecture Rules

- Keep the monorepo TypeScript-first.
- Use `apps/api` for the Express API.
- Use `apps/web-dashboard` for the React and Vite dashboard.
- Use shared packages for reusable behavior:
  - `packages/schemas`
  - `packages/scanner`
  - `packages/policy-engine`
  - `packages/remediation`
- Keep cross-app contracts in `packages/schemas`.
- Use Zod for runtime validation and inferred TypeScript types.

## Policy Engine Rules

- Policy behavior must be represented as declarative TypeScript or JSON rule dictionaries.
- Do not build the policy engine as a pile of hardcoded business `if/else` statements.
- Rule IDs, severity, decision, explanation, and remediation eligibility must be explicit and auditable.
- Rule evaluation must be deterministic for the same inputs.

## Database Rules For Phase 2

When the Prisma schema is introduced:

- `AuditEvent` must include an `actor` field.
- `Approval` must include an `actor` field.
- `Finding` must have a strict 1:1 relation to `PolicyDecision`.
- `Finding` must have a strict 1:1 relation to `Remediation`.
- `Finding` must have a strict 1:1 relation to `Approval`.
- Prefer immutable audit records over destructive updates for security-relevant history.

## Scanner Rules

- Dependency inspection is an SBOM generator. Do not present it as a full CVE vulnerability scanner.
- Secret scanning in v1 uses high-confidence regex patterns only.
- Document the lack of entropy checks as a v1 limitation.
- Prefer deterministic parsing and structured inputs over brittle string slicing where reasonable.

## API Rules

- All list endpoints must include `limit` and either `cursor`, `offset`, or `page`.
- Validate all request params, query params, and bodies with Zod.
- Return stable error shapes.
- Avoid leaking file contents or secrets in API responses.

## Frontend Rules

- The dashboard must show a CISO-level Platform Risk Score such as `A`, `B`, `C`, or `F`.
- The dashboard must include a highly visible Pending Approvals action widget.
- Prefer dense, operational layouts over marketing pages.
- Use TanStack Table for findings and scan result tables once real data is introduced.

## Remediation Rules

- Generate detailed remediation only for findings with policy decisions of `BLOCK` or `REQUIRE_APPROVAL`.
- Keep remediation deterministic. Do not use LLM-generated fix text in v1.
- Keep fix templates scoped to the specific finding category and evidence.

## Engineering Standards

- Keep commits small and phase-aligned.
- Preserve strict TypeScript settings.
- Do not relax linting or type checking to hide design problems.
- Add tests with new behavior.
- Update docs when architecture, threat model, or demo behavior changes.
