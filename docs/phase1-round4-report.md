# Phase 1 Round 4 remediation

Reviewed starting head: `8d0032b35ff0fe2b5422fdecaf2a06482d462abd`.
This follow-up addresses the seven comments submitted on that head. It does not
constitute independent security acceptance. Phase 5 and subsequent-phase changes
remain on hold until the preceding gates are satisfied.

| Finding                                              | Implementation and regression                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication work before admission limiting        | Aggregate IP admission limit precedes requestContext/JWT/JWKS; actor/route limiter remains afterward. HTTP regression confirms exhausted traffic never reaches authentication.                                                                              |
| Reverse proxy clients share one bucket               | Validated explicit proxy IP/CIDR configuration, no implicit trust. Azure Compose pins Caddy to a dedicated address trusted by API. HTTP regression covers distinct clients, ignored untrusted headers and spoofed leftmost hops.                            |
| Unresolved dependency ranges counted as advisories   | Count only CONFIRMED matches; report unresolved dependency versions separately in human and structured summaries. Real CLI regression uses a range without provider requests.                                                                               |
| Configured role claim falls back to unrelated claims | Configured claim exclusively controls authorization, absent/empty/unrecognized configured values fail closed. Regression covers unrelated admin claims. Unconfigured legacy role/roles behavior remains compatible.                                         |
| Raw Dockerfile evidence emitted by CLI               | Apply shared evidence and text sanitizers before every finding output format. Real JSON/JSONL CLI regressions retain structured findings while removing URL credentials.                                                                                    |
| Refresh completion recreates a logged-out session    | Session generation invalidates pending refresh/login completions; stale failures cannot clear a newer session, stale finally callbacks cannot clear a newer refresh. Tests cover late success/failure after logout and subsequent login.                    |
| Demo scan audit loses authenticated caller           | Pass caller from controller into persisted queue requester/payload and local scan executor through runConfiguredScan audit fields. Controller/executor regressions plus actual PostgreSQL CI assert requester and SCAN_CREATED/SCAN_COMPLETED audit actors. |

## Verification

Local verification: 224 unit tests, formatting, strict types, workspace build,
documentation and deterministic integration passed. Lint and final published CI
results are recorded in the PR handoff. PostgreSQL and Docker are
unavailable locally; their checks must be verified on the final published CI head.
No live-provider or production deployment is claimed. No migration SQL, history,
lockfile, main, or downstream branches are modified.

## Compatibility and operations

Configured OIDC claims no longer accept fallback privileges. Providers must place
AgentShield roles in the configured claim. New proxy configuration defaults to no
forwarded-header trust. Existing custom reverse-proxy deployments must configure
their controlled addresses; see deploy/azure/README.md. Azure Compose uses a fixed
subnet and requires consistent address/trust updates if an operator has a collision.
The pre-auth aggregate IP budget is intentionally shared by NAT clients and is
process-local; later production fleet-wide enforcement remains separate.
CLI adds advisoryCount/unresolvedCount and changes erroneous advisory totals.
Logged-out sessions discard pending responses. Historical demo audit records are
preserved; newly queued caller identities are attributed correctly.

Rollback uses an ordinary revert, never history rewriting. Reverting these security
fixes reopens their associated findings and requires renewed review.
