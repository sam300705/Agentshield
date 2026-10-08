# Phase 1 Round 8 Remediation Handoff

Phase: 1, PR: #9, branch: `phase1/consolidate-stabilize`.
Audit basis: `245523287233515d8325e3ce34247853ec0acadc`.
No downstream PR was merged, advanced, or rewritten.

## Remediations

- Event replay now requires a stored hash of canonical raw input, not redacted evidence.
- Historical events remain immutable; legacy uncommitted identity requires a fresh event key.
- Demo scan cleanup filters every deletion by organization and seed marker.
- Incomplete OSV batch responses fail explicitly instead of appearing clean.
- Archive extraction counts directory entries against the bounded extraction budget.
- Agent-event ingestion checks that sessions remain active inside the transaction.
- The gateway records policy decisions without trusting optional client-side event ingestion.
- Receipt exports are canonical and hash-verified; inconsistent rows return an explicit error.
- Approval resources and review reasons are sanitized at storage and service-return boundaries.
- CORS configuration must specify a bare origin and use HTTPS in production.
- Azure worker instructions provide the required CORS origin.

## Data migration

`20261008130000_agent_event_raw_digest` adds only an optional raw-input
hash column to `AgentEvent`. Existing migrations and historical rows are
unchanged. Old events without the new digest must not be silently deduplicated.

## Verification and release gates

- Prisma migration, safety tests, browser tests, container checks, and final-head CI must pass.
- Local git/network access was unavailable; verification relies on GitHub-hosted CI.
- Independent security acceptance is separate from green CI and remains required.
- External OIDC, GitHub App, live deployment, and backup qualification are not claimed.
- Preserve the PR stack: #9 to #10 to #11 to #12. Phase 2 is not authorized.

## Failure and fix record

- Redacted input previously collapsed distinct event identities; raw digest fixes replay.
- Seed cleanup previously wiped unrelated history; seeded-scan filtering limits deletion.
- Malformed OSV responses previously looked clean; strict validation preserves uncertainty.
- New source changes initially failed TypeScript and formatting checks; diagnostics were
  used to repair the actual failures, without disabling either check.
