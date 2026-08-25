# Contributing to AgentShield

Thank you for helping improve AgentShield. The project is a TypeScript-first security control plane, so contributions should favor explicit contracts, deterministic behavior, tenant isolation, auditable state transitions, and honest documentation over feature breadth.

## Before starting

Read [`AGENTS.md`](./AGENTS.md), [`SECURITY.md`](./SECURITY.md), the [architecture](./docs/architecture.md), and the [threat model](./docs/threat-model.md). For changes that affect authentication, authorization, persistence, scanning, deployment, or data handling, describe the trust boundary and failure behavior in the pull request.

Never use real customer, hospital, medical, personal, credential, or production repository data. Use synthetic fixtures only. Never commit secrets, connection strings, private keys, tokens, signed URLs, generated production exports, or local environment files.

## Development workflow

Create a focused branch from the current reviewed base. Keep commits small and phase-aligned. Use the existing pnpm version and the frozen lockfile. Do not force-push shared branches, rewrite history, merge `main`, delete resources, or accept paid service terms as part of a contribution.

Install dependencies and run the relevant checks:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

If a check cannot be run locally, state the exact command, reason, and environment limitation in the pull request. Do not mark an unexecuted check as passed.

## Code expectations

Validate request bodies, query parameters, and route parameters at the API boundary with Zod. Enforce authentication, authorization, organization isolation, and object-level access control on the backend. Use stable error shapes and avoid returning file contents, secrets, internal stack traces, or unbounded query results.

Treat repository content and scan inputs as untrusted data. Scanners must not execute repository code. Preserve traversal limits, symlink safety, cancellation, temporary-file cleanup, deterministic fingerprints, redaction, and bounded processing behavior. Changes to the database require a migration and corresponding tests; do not use `prisma db push` as a substitute for a reviewed migration.

Keep policy evaluation, remediation, scanner output, and receipt generation deterministic. Do not introduce real LLM calls into the v1 offline path. New security-sensitive state transitions should be auditable and idempotent where retries are possible.

## Pull requests

Use the pull-request template. Explain the problem, the security and tenant implications, the implementation, migration or rollback impact, tests actually run, and any manual prerequisites. Include screenshots only when they show the real application and contain no sensitive data. Reviewers should be able to reproduce the result from the branch and its documented configuration.

A maintainer must review changes affecting authentication, authorization, cryptography, secrets, migrations, scanner boundaries, deployment, or data retention. Do not claim compliance, certification, clinical safety, or production availability without evidence and explicit approval.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [`SECURITY.md`](./SECURITY.md) and use GitHub's private vulnerability-reporting flow when available.
