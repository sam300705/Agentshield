# Phase 1 Round 6 remediation and handoff

Review starting head: `5533577ed6996d02f888e135dc6c23a057f8316e`. Its full CI [37735643464](https://github.com/sam300705/Agentshield/actions/runs/37735643464) passed, including 245 unit tests, six browser tests, PostgreSQL legacy upgrade/data preservation, cancellation attribution, gateway/lifecycle checks, container build/startup and SARIF. The independent review then identified six additional findings; green CI did not satisfy acceptance.

| Finding                                             | Fix and meaningful regression                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent evidence uses a separate incomplete sanitizer | Retain legacy sensitive-key redaction, then apply the shared sanitizer before persistence/hash construction. Chain regression and actual PostgreSQL ingestion assert Stripe and underscore-containing GitHub values are absent.                                                   |
| Live API origin silently defaults to localhost      | Require explicit HTTPS origin without userinfo, path, query or fragment in live mode. AuthGate refuses incomplete configuration, and request validation occurs before token retrieval/fetch. Refuse fetch redirects. Invalid origins and authenticated HTTPS requests are tested. |
| Oversized files bypass traversal budget             | Separate visited-file counter increments before filesystem lookup/size filtering. Large iterator regression tests both accepted and oversized files and early directory closure.                                                                                                  |
| Final-attempt abandoned jobs become stranded        | Locked recovery classifies exhausted jobs as FAILED dead letters, clears retry scheduling, and closes the scan. Explicit cancellation retains priority; renewed-lease predicate remains authoritative. Unit and PostgreSQL regressions exercise terminal recovery.                |
| Repository synchronization silently truncates       | A full tenth page raises `GITHUB_REPOSITORY_LIMIT_EXCEEDED`, refusing a success result or `lastSyncedAt` write. Bounded complete-page success and failure-without-persistence tests cover the boundary.                                                                           |
| Approval frequency exceeds its schema bound         | Define approval frequency as APPROVAL_REQUEST events divided by all session events (zero for an empty session). Documented bounded proportion handles approval-only and multiple-request streams without schema relaxation.                                                       |

## Verification and next step

Local checks and exact published-head CI are recorded in PR #9. Independent acceptance remains pending. Preserve #9 → #10 → #11 → #12; no merges, retargeting, force pushes, migration history edits or downstream updates. Phase 5 remains on hold; design frame discovery is complete in `phase5-design-handoff.md`.

No new database migration or lockfile change is required. Existing events, integrity hashes and receipts remain immutable; fresh evidence uses the corrected sanitizer. Historical receipt verification uses stored evidence digests and hashes. Changed evidence can require a fresh action request, rather than rewriting old approvals/history.

Owner configuration is separate: live builds need `VITE_API_BASE_URL=https://<approved-api-origin>` plus valid OIDC configuration. This remediation does not provision endpoints, activate providers, deploy or claim live verification. Repository installations hitting the page bound need an explicitly reviewed continuation/limit extension; partial synchronization is never recorded as successful.

## Failure record

The session's pnpm shim was absent after runtime refresh; the default pnpm 11 command could not run the repository scripts. Restoring Corepack's shim and using the pinned pnpm 9.15.4 command fixes the toolchain without changing lockfiles.

Round 5 local browser launch was unavailable: initially Chromium was missing, then the installed full Chromium was denied a process-singleton socket by the execution environment. The actual published CI browser gate passed all six tests. Do not repeat that unchanged local launch or represent it as a local PASS. PostgreSQL/container checks likewise run on CI when Docker is unavailable locally.
