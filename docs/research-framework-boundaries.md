# Framework approval and recovery comparison

Work package R0-C1, started 2026-10-21. This is parallel research, not a dependent
implementation phase or acceptance of Phase 3. AgentShield candidate bf40ef1 stays
unchanged; its live-provider gate remains blocked by external configuration.

Objective: test whether existing frameworks already address proposed approval and
recovery value, and identify an integration boundary worth validating with users.
Current evidence: pinned ADK confirmation code checks original arguments and
consumption; LangGraph documents node restart on resume. Public issues describe
replay and caller-identity concerns, but issue status is not verification.
Scope: official source/license inspection, public issue evidence and an isolated
LangGraph probe using a loopback HTTP provider and SQLite effect ledger. Exclusions:
LLM calls, live GitHub, outreach, installed application dependencies, provider writes
outside the fixture, new product features and Phase 4 implementation.
Dependencies/components: Python research environment outside the checkout;
LangGraph 1.2.16; original research fixture under docs/research-experiments.
Invariants: no customer data/credentials; no production configuration; no replayed
effect presented as an AgentShield or universal framework guarantee. Reuse decision:
investigate framework adapters and preserve the current TypeScript runtime.
Migration impact: none. Tests: positive completed-task control, lost acknowledgement
after committed HTTP effect, and provider-owned deduplication control across the
three durability modes. Acceptance: exact versions, reproducible results, contrary
evidence and explicit uncertainty; no demand or production claim. Recovery: stop
fixture servers, remove their temporary databases/environment; documentation-only
development commit can be reverted without product/runtime changes.

Probe status at package start: NOT RUN. Results and source ledger follow after
execution. No external issue or comment was created or changed.

## Source and search ledger

Lookups ran on 2026-10-21 through the GitHub API. Exact searches:
`repo:google/adk-python is:issue "tool confirmation"` (73 results, first five read)
and `repo:langchain-ai/langgraph is:issue "interrupt" "side effects"`
(23 results, first five read). This is a bounded query sample, not an exhaustive
survey. Initial queries without `is:issue` returned HTTP 422; the corrected queries
above succeeded. No search failure was treated as evidence of absence.

Official release lookup: `repos/google/adk-python/releases/latest`, then
`repos/google/adk-python/commits/v2.12.0`; tag v2.12.0 resolves to
`38381f65f2bee0f70a89f938ee64e51b34916fa7`. Official LangGraph latest-release lookup
returned CLI 0.4.37, which is not the core runtime version. Inspecting
`repos/langchain-ai/langgraph/releases?per_page=10` identified core tag 1.2.16;
`repos/langchain-ai/langgraph/commits/1.2.16` resolves to
`41c9c22fdc83d68a2859d0c9a2b627c8615a792f`. Do not substitute a monorepo CLI/SDK
release for its runtime version. Files below were fetched with
`repos/{repository}/contents/{path}?ref={full-commit}` and decoded locally.

| Evidence                                                                                                                                                                            | Source observation                                                                                                               | Boundary and uncertainty                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADK confirmation target resolution](https://github.com/google/adk-python/blob/38381f65f2bee0f70a89f938ee64e51b34916fa7/src/google/adk/flows/llm_flows/tools/_confirmation.py#L149) | Requires an original call in history, a registered confirmation-requiring tool, matching tool name and arguments.                | Contrary to treating argument-bound tool approval as new. Inspection is not an authenticated serving-layer or concurrency experiment.                                               |
| [ADK consumption handling](https://github.com/google/adk-python/blob/38381f65f2bee0f70a89f938ee64e51b34916fa7/src/google/adk/flows/llm_flows/tools/_confirmation.py#L302)           | Searches results after the first answering user event, drops consumed confirmations, and skips resolution when all are consumed. | Existing replay protection is present in this pinned source. No proof of transactional provider-effect deduplication, multiworker safety or independent reviewer authority follows. |
| [ADK confirmation model](https://github.com/google/adk-python/blob/38381f65f2bee0f70a89f938ee64e51b34916fa7/src/google/adk/tools/tool_confirmation.py#L28)                          | Experimental model has confirmed=false default, forbidden extra fields and typed response parsing.                               | A parsed confirmation does not authenticate the person submitting it. No broad framework vulnerability is inferred from a field model.                                              |
| [ADK regression source](https://github.com/google/adk-python/blob/38381f65f2bee0f70a89f938ee64e51b34916fa7/tests/unittests/flows/llm_flows/tools/test_confirmation.py#L1135)        | Includes consumed-confirmation/no-revalidation tests and argument-mismatch cases.                                                | Source read; upstream ADK tests NOT RUN. Their existence is not proof that every serving path enforces authority.                                                                   |
| [LangGraph interrupt contract](https://github.com/langchain-ai/langgraph/blob/41c9c22fdc83d68a2859d0c9a2b627c8615a792f/libs/langgraph/langgraph/types.py#L903)                      | Resume uses Command and re-executes node logic from its start; a checkpointer is required.                                       | Existing human-in-loop persistence is a comparator, not a product gap. Functional task completion can avoid some replay; see the positive experiment.                               |
| [LangGraph durability modes](https://github.com/langchain-ai/langgraph/blob/41c9c22fdc83d68a2859d0c9a2b627c8615a792f/libs/langgraph/langgraph/types.py#L98)                         | sync/async/exit describe graph persistence timing.                                                                               | Do not infer exactly-once external execution from persistence mode.                                                                                                                 |

ADK source LICENSE is Apache-2.0; pyproject requires Python >=3.11 and declares
Google GenAI/auth, FastAPI, cryptography, OpenTelemetry and other dependencies.
LangGraph source LICENSE is MIT; core manifest identifies version 1.2.16, Python

> =3.10 and langchain-core, checkpoint, SDK/prebuilt, xxhash and pydantic dependencies.
> Licenses/manifests were read at the commits above. No upstream source is copied into
> AgentShield; no application dependency or lockfile is changed. Research packages
> were installed only into an isolated /tmp virtual environment. Full transitive
> license/security/provenance audit, operating cost, lock-in and migration burden are
> NOT VERIFIED; neither framework is approved for adoption by this source inspection.

## Public reports: evidence and contrary checks

- [ADK issue 7434](https://github.com/google/adk-python/issues/7434) reports repeated
  approval execution and is closed. Linked PR 7435 is closed but its API merged flag
  is false; that status alone does not prove a fix. The independently inspected
  pinned source already contains consumption checks. Do not relabel this historical
  report as a confirmed current flaw or use it to claim AgentShield superiority.
- [ADK issue 7569](https://github.com/google/adk-python/issues/7569) reports caller
  forgery on A2A/run serving paths. A collaborator's
  [comment](https://github.com/google/adk-python/issues/7569#issuecomment-6207503637)
  reports reproduction and distinguishes authenticated context from body-supplied
  identity. This task did not reproduce it or inspect every serving/auth path.
  Treat it as a test hypothesis for an authenticated adapter, not an AgentShield
  vulnerability finding or a blanket verdict on the framework.
- [LangGraph issue 9240](https://github.com/langchain-ai/langgraph/issues/9240)
  requests a narrow documentation clarification, not a new exactly-once runtime.
  Its comments explicitly discuss completed-task replay avoidance and transactional
  provider deduplication. One experiment commenter discloses work on Agent Signal;
  that vendor report is not independent customer validation. The local probe below
  is original and separately executed, rather than claiming their measurements.
- [LangGraph issue 8464](https://github.com/langchain-ai/langgraph/issues/8464)
  proposes idempotency middleware using an exactly-once claim. It is an open proposal,
  not proof of shipped functionality or absence of other solutions. A local claim
  alone cannot atomically commit a remote provider effect.

These reports suggest approval identity and recovery questions to investigate.
They do not establish prevalence, buyer demand, willingness to pay or a reason to
replace the present PostgreSQL coordinator. No outreach or external comment was sent.

## Independently executed comparator probe

PASS: nine cases with Python 3.12.14, LangGraph 1.2.16, checkpoint 4.3.0 and
langchain-core 1.6.13. Full dependency snapshot is in
[the isolated research lock](research-experiments/langgraph-research-requirements.lock),
original fixture in [the probe](research-experiments/langgraph_recovery_probe.py),
and machine-readable output in
[the dated results](research-experiments/langgraph-recovery-results-20261021.json).
`pip check` passed. Cleanup was tightened to explicitly close SQLite connections;
a second execution produced byte-identical results. No application checks are
substituted with this experiment.

| Scenario                                                             | sync requests/effects | async requests/effects | exit requests/effects | Interpretation                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------- | ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Completed durable task then interrupt/resume                         | 1 / 1                 | 1 / 1                  | 1 / 1                 | Existing framework avoids repeating this completed task. Positive control contradicts a blanket replay-failure claim.                            |
| Effect commits, first HTTP reply is lost, failed task resumes        | 2 / 2                 | 2 / 2                  | 2 / 2                 | Checkpoint timing does not deduplicate this external effect. First committed SQLite effect is observed before resume.                            |
| Same lost reply, provider commits a unique operation key with effect | 2 / 1                 | 2 / 1                  | 2 / 1                 | Deduplication at the provider's own transactional boundary handles this fixture. Reuse it where the actual provider offers equivalent semantics. |

Reproduce from repository root using an isolated environment:

```sh
python3 -m venv /tmp/agentshield-comparator
/tmp/agentshield-comparator/bin/python -m pip install -r docs/research-experiments/langgraph-research-requirements.lock
/tmp/agentshield-comparator/bin/python docs/research-experiments/langgraph_recovery_probe.py
```

The package index uses normal TLS/artifact validation. The version snapshot is not
a signed provenance attestation or a reviewed production lock. The probe disables
tracing, makes no model call, bypasses HTTP proxies for its loopback provider,
uses temporary SQLite files, stops servers and closes connections. Research artifacts
add no product service, provider adapter or authoritative policy input.

Limitations: workflow checkpoint saver is in memory; recovery is a caught failure
and same-process resume, not process-crash persistence. There are no concurrent
workers, hostile identities, tenant policies, cancellation, production provider,
latency/load or cost measurements. Provider uniqueness is a real local SQLite
constraint, not a GitHub Check idempotency guarantee. AgentShield action admission
is still HELD with no dispatch consumer, so this is not a measured action-execution
benchmark against AgentShield. Existing Check-publisher regressions qualify a
separate descriptive-evidence flow. ADK runtime experiments remain NOT RUN.

## Build, integrate and falsify

Decision: EXTEND existing AgentShield admission/receipt boundaries; DEFER framework
replacement and any new action adapter. INVESTIGATE optional adapters for existing
framework confirmation/resume interfaces after demand and the supported provider
boundary are qualified. Do not build another workflow engine or generic approval UI
on the claim that these capabilities are absent.

| Hypothesis / who needs it                                          | Existing answer and possible unmet need                                                                                                                                                                         | Enforcement and disproof                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform team needs independently authorized exact provider action | ADK already binds confirmation to tool arguments; host/framework authentication may suffice. The unresolved hypothesis is tenant/reviewer/evidence/policy binding at a credential-controlled provider boundary. | Test authenticated host baseline before adding a broker. Stop if existing controls meet the same need with less friction or the agent keeps direct write credentials. |
| Incident responder needs safe recovery after lost acknowledgement  | LangGraph already persists task results; transactional provider uniqueness handles this probe when available. Some providers may require explicit unknown-outcome reconciliation.                               | Require authoritative provider observations and bounded reconciliation. Narrow/reject operations whose ambiguity cannot be resolved; do not promise exactly-once.     |
| Security reviewer needs portable evidence                          | Existing framework events and attestation tools may already suffice. Independent receipt usability remains unvalidated.                                                                                         | Compare investigation effort and trust-root handling with existing logs. Stop if extra receipts are not used or cannot establish a meaningful capture boundary.       |

Pilot additions: ask for a concrete approval/recovery incident and a satisfactory
existing workflow as contrary evidence. Compare installation time, distinct-actor
review setup, changed-context blocks, useful blocks/false positives, repeated use
and unknown-outcome recovery against the team's present framework/provider controls.
Validate willingness to pay separately. Owner-approved interviews/comparator pilots
remain NOT RUN. No new differentiator or commercial demand is declared established.
