# Phase 3 threat to regression matrix

Boundary: authenticated control API, signed webhook ingress, trusted configured
identity/App secret, application-owned PostgreSQL and simulated provider HTTP.
Privileged database/App-key administrators remain trusted. Synthetic tests are not
live GitHub, external IdP, production isolation or user-demand evidence.

| Threat/prerequisite                                     | Actual regression/boundary                                                                                                                     | Status                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Foreign tenant or forged webhook tenant                 | Signed HTTP derives persisted installation owner, concurrent delivery dedupe and real audit rollback; immutable parent FKs                     | PASS local PostgreSQL/HTTP; published CI/review pending                      |
| Requester reuses approval after selected access removal | Authority service rereads selected repository under installation-before-repository locks; real API refuses operation                           | PASS targeted authority PostgreSQL                                           |
| Mutable branch/renamed repository                       | Accepted full SHA acquisition and numeric repository identity; scoped token body/permissions asserted by HTTP provider simulator               | PASS targeted; live token enforcement NOT RUN                                |
| Malformed/unsafe numeric ID or contradictory pagination | Client/normalizer reject unsafe ID and incomplete total-count pages; no rounded identity or successful partial sync                            | PASS local unit; published CI/review pending                                 |
| Slow provider blocks database/job cancellation          | Actual HTTP response paused; independent PostgreSQL connection acquires advisory and job locks, cancels job                                    | Old publisher FAIL reproduced; corrected targeted PASS                       |
| Concurrent/stale publisher                              | Live lease excludes second claim; expiry/new generation reconciles visible object; old response cannot change final state or add success audit | PASS targeted PostgreSQL/HTTP                                                |
| Claim audit fails before dispatch                       | Real trigger aborts claim, generation/lease/dispatch marker roll back, provider-call count stays unchanged                                     | PASS local PostgreSQL/HTTP                                                   |
| Crash/audit failure after remote effect                 | Real audit trigger rolls back finalization, committed marker remains; lease recovery updates existing object without duplicate create          | PASS targeted PostgreSQL/HTTP                                                |
| Provider create has ambiguous invisible outcome         | Empty lookup never authorizes a second create; ten attempts stop with UNKNOWN and one remote object                                            | PASS targeted simulator; real visibility/ordering NOT RUN                    |
| Missing/partial receipt produces green Check            | Valid-hash partial receipt with no blocking findings yields action_required; conservative receipt gate                                         | PASS targeted HTTP/database                                                  |
| Populated upgrade rewrites customer authority/history   | Four predecessor histories, retained Check IDs, conservative legacy uncertainty, consumed authorization and HELD records preserved             | PASS targeted populated PostgreSQL                                           |
| Direct provider credential bypass                       | Keys remain server-side; narrower installation-token repository/permission request                                                             | PARTIAL: live custody/permissions and production privilege isolation NOT RUN |
| Delayed remote application after lease loss/cancel      | No provider CAS is claimed; local fencing protects local projection only                                                                       | Explicit limitation; controlled staging/reconciliation qualification pending |
| Resource exhaustion/fairness                            | Ingress/archive bounds, tenant lanes, batch/attempt/deadline bounds and worker shutdown signal                                                 | PARTIAL: sustained load, throughput, isolation and operating cost unmeasured |

See `test:github-e2e`, `test:action-authority`, `test:phase2-upgrade` and the current
[handoff](phase3-integration-handoff.md). Final exact-head CI/review is recorded in
the new integration PR after publication, not inferred from predecessor green CI.

P3-D2 adds adversarial pagination/count drift before persisted synchronization,
provider success with incorrect external ID/SHA, one-hour worker clock skew,
explicit refusal/recovery versus ambiguous create, and a real publication-row/audit
barrier race between successful finalizer and waiting claimant. Attacker capability:
untrusted provider responses or delayed scheduling, not arbitrary database-admin
writes; synthetic database mutations only arrange the tested race. These regressions
qualify the adapter/application boundary, not real GitHub behavior or global capture.

Legacy selection trust on upgrade: attacker/operational prerequisite is a retained
GitHub repository once linked to an active installation but subsequently deselected
before the access flag existed. Four real populated upgrade histories must deny new
queue admission until verified synchronization, preserve every customer row and keep
the stale ID denied afterward. This is migration/queue evidence; current authority
regressions separately exercise deselected-repository action refusal. Live selection
refresh and production rollout/rollback remain unqualified.

P3-Q1 read-only observation: untrusted provider fields and concurrent local lifecycle
changes cannot yield an accepted diagnostic for the wrong ID/SHA/external ID/status/
conclusion or incomplete receipt. Tests exercise real HTTP, scoped Checks-read token
requests, persisted projection mutation and a tagged independent PostgreSQL activity
probe. No provider write occurs. Signature presence remains NOT_VERIFIED; unsigned
state is explicit. A post-observation change or undetected change-and-restore is a
residual limit; this diagnostic is not an action authorization or atomic global snapshot.
