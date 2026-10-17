# Product research protocol and evidence ledger

Desk-research checkpoint: **2026-10-15 UTC**. This is a bounded first pass, not
completed market research, an exhaustive competitor survey or evidence of demand.
No customer interviews, outreach, purchases or live comparator trials occurred.
The referenced research PDF was not available in this checkout; no findings are
attributed to it. Illustrative examples are not customer evidence.

## Protocol and questions

Target user: platform/security engineer responsible for GitHub coding agents.
Buyer hypothesis: owner of engineering platform or application security budget.
Problem hypothesis: consequential provider operations can escape review context,
approvals can become stale, and ambiguous outcomes are difficult to investigate.
Comparator: existing GitHub controls plus a gateway/policy engine and audit tooling.
Outcome: reduce unauthorized supported actions and time to explain/reconcile an
outcome, without unacceptable installation or review friction.

Use official documentation and pinned source first. Separate documented capability,
source observation, executed behavior and customer evidence. Look for an existing
solution before proposing a component. Record negative findings and unavailable
sources. Do not infer competitive absence from a missing README feature.
Next research pass: public issue histories and operator incident reports with
independent corroboration, then consented interviews and controlled comparative pilots.
Repeated production need for AgentShield has **not yet been established**. Public
issue patterns below are provisional problem evidence, separate from buyer demand.

## Reproducible lookup ledger

All lookups below ran on 2026-10-15. No general web-search service was available;
these were exact official URL fetches and GitHub API queries, not a claim of broad
search coverage. HTML script/style content was removed before reading passages.
Mutable documentation is dated observation; it may differ when fetched again.

| ID / exact lookup                                                                                                                                                                                                    | Observation and contrary evidence                                                                                                                                                    | Limitation                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 `GET https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`                                                                                                             | Required reviewers and prevent-self-review already exist for protected environments; availability depends on plan/repository visibility.                                             | Job/deployment approval is an existing comparator. No experiment establishes a remaining exact-action gap.                                                                               |
| R2 `GET https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28`                                                                                                                                              | Create-reference accepts ref/SHA and documents 201/409/422; Contents write scope is required. Update-reference has different semantics.                                              | Returned examples currently use API version 2026-03-10 despite the requested query. Pin the actual adapter version explicitly and qualify it live before implementation claims.          |
| R3 `gh api repos/agentgateway/agentgateway/commits/main --jq .sha`, then [README at 7261de55](https://github.com/agentgateway/agentgateway/blob/7261de55ae727fdb8f5a42c6d07d8e21a99c4b5c/README.md)                  | Documents MCP/A2A proxying, JWT/OAuth, CEL RBAC, rate limits and telemetry. This directly contradicts any claim that agent governance/gateways are absent.                           | README claims only; detailed `https://agentgateway.dev/docs/standalone/main/security/authorization/` returned 403. No enforcement or bypass experiment run.                              |
| R4 `GET https://www.openpolicyagent.org/docs`; `gh api repos/open-policy-agent/opa/releases/latest`                                                                                                                  | OPA explicitly separates declarative decision-making from enforcement. Latest observed release v1.21.2, published 2026-10-12.                                                        | No runtime benchmark or integration; do not replace current rules on popularity.                                                                                                         |
| R5 `GET https://docs.cedarpolicy.com/`; `gh api repos/cedar-policy/cedar/releases/latest`                                                                                                                            | Existing authorization language; documentation addresses principal/action/resource/context and avoiding mutable identifiers. Observed release cedar-policy-cli-v4.13.0 (2026-09-15). | Fetched landing reference labels language v4.5; release metadata alone does not prove compatible SDK behavior.                                                                           |
| R6 `GET https://docs.sigstore.dev/cosign/verifying/verify/`; `gh api repos/sigstore/cosign/releases/latest`                                                                                                          | Existing blob/image signature verification with trusted certificate identity/issuer and bundles. Observed release v3.1.3 (2026-08-06).                                               | Signature authenticity does not prove action safety or capture completeness. No keyless signing or transparency experiment run.                                                          |
| R7 `GET https://in-toto.io/docs/what-is-in-toto/`                                                                                                                                                                    | Supply-chain step integrity and transparency are established concepts.                                                                                                               | Not evidence that AgentShield needs a new attestation format or external anchor now.                                                                                                     |
| R8 `gh api repos/gitleaks/gitleaks/commits/master --jq .sha`, then [README at b58d3f10](https://github.com/gitleaks/gitleaks/blob/b58d3f102cf3a2c84cb7f923d05c25c9b1aed84b/README.md); releases/latest               | Established secret detection. Current pinned README says feature-complete/security fixes only and points to Betterleaks; latest observed release v8.30.1 (2026-03-21).               | Maintenance posture needs evaluation; automatic adoption would be premature. CLI and hosted-action licensing must be checked separately.                                                 |
| R9 `GET https://semgrep.dev/docs/semgrep-ci/overview`                                                                                                                                                                | Existing CI scanning, findings triage, full/diff-aware scans and blocking configuration.                                                                                             | No runtime, edition/license, accuracy, cost or privacy comparison performed. Basic scanning/dashboard is not a validated differentiator.                                                 |
| R10 `npm view packageurl-js version license repository.url dependencies --json`; `gh api repos/package-url/packageurl-js/git/ref/tags/v2.0.1`; dereference annotated tag                                             | Version 2.0.1, MIT, no runtime dependencies; source/installed LICENSE inspected. Commit cd1eb4b050ea66462a729f800166ee0b02fc4c5c; parser normalizes/validates typed components.      | First raw source request used annotated-tag object 188f4409 and returned 404; dereferencing to the commit fixed acquisition. Local boundary regressions qualify only exercised behavior. |
| R11 `gh api repos/package-url/purl-spec/commits/main --jq .sha`, then [npm definition at c1dc0979](https://github.com/package-url/purl-spec/blob/c1dc0979f7b10d00e9ab002b1111638761ab1fc1/types/npm-definition.json) | npm scope is namespace; @ is encoded; official example has colon-bearing vcs_url. These observations exposed current PURL validation/emission defects.                               | A package range in inventory is not a resolved installed package version.                                                                                                                |

Selected fetched-byte SHA-256 fingerprints (not claims of publisher signatures):

- R3 README: `8a7ac2c178edebeae442961d8222acaf3dec9bcc1419cec43059e6c544b45f4d`.
- R8 README: `65e87e68f4a16aefa1f1fba55b2e7a9b9bc8716393b7ddb013fc7c7bef4e4bc1`.
- R10 src/package-url.js: `b9967047c90a8640076b9dff8024f1823a0e74e76f96363912dd91a78df7df2c`.
- R11 npm definition: `ec4c8e20cfce0b44dc4c1cd43e8fe58de70bbb935c89a2073dffe22f5ea4821b`.

## Public problem evidence and contrary results

Additional exact GitHub issue queries on 2026-10-15 used
`gh api --method GET search/issues -f q='<query>' -f per_page=<limit>`.
Counts are search results, not affected customer counts or validated incidents.

| Exact query / observed count                                                     | Evidence read                                                                                                                                                                                                                                                                                                                                | Interpretation and confidence                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo:agentgateway/agentgateway is:issue authorization` / 197, first 5 inspected | [3635](https://github.com/agentgateway/agentgateway/issues/3635), [3668](https://github.com/agentgateway/agentgateway/issues/3668), [2536](https://github.com/agentgateway/agentgateway/issues/2536), [3989](https://github.com/agentgateway/agentgateway/issues/3989); 3374 title only. Direct issue status and 2536 comments also fetched. | Repeated reports concern OAuth issuer/discovery interoperability across clients/providers. 2536 comments dated July 29 and August 13 report similar Keycloak/Entra issues; 3635 is dated September 23. This corroborates recurring integration friction within one ecosystem, not AgentShield demand or independently reproduced vulnerabilities. All four inspected issue states were open. |
| `repo:cli/cli is:issue approval stale review` / 12, first 4 inspected            | [2342](https://github.com/cli/cli/issues/2342), [2053](https://github.com/cli/cli/issues/2053), [9839](https://github.com/cli/cli/issues/9839), [8363](https://github.com/cli/cli/issues/8363)                                                                                                                                               | Historical reports about review dismissal/re-review, branch-policy diagnostics and configuration. They show existing workflows and friction, but do not demonstrate that a new exact-action product is needed. No current reproduction.                                                                                                                                                      |
| `repo:temporalio/sdk-typescript is:issue timeout activity duplicate` / 1         | [1115](https://github.com/temporalio/sdk-typescript/issues/1115), dated 2023-05-02                                                                                                                                                                                                                                                           | Report concerns workflow failure classification and explicitly lacks a minimal reproduction. Weak evidence; does not establish duplicate effects or justify orchestration replacement.                                                                                                                                                                                                       |

Issue 3989 reports missing request identity in denied model-call logs and supplies
a reproduction/code path for agentgateway v1.6.0. It was created on this lookup
date and had no comments. Treat it as an unconfirmed capture-boundary hypothesis
to evaluate in a comparator trial, not a proven competitor deficiency. No issue
was filed, commented on or changed during research.

Implication: prioritize diagnosable identity/configuration boundaries and honest
capture status; retain mature identity components. Do not build custom OAuth proxy
infrastructure in response to these reports. The exact-action/unknown-outcome value
proposition still needs direct interviews and controlled baseline comparison.

## Comparator matrix

| Existing solution                       | Addresses                                                     | AgentShield hypothesis requiring validation                                                | Current decision                                                     |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| GitHub environments / provider controls | Review, self-review prevention, branch/deployment constraints | Exact supported operation/context and unknown-outcome explanation outside a deployment job | INTEGRATE existing controls; never bypass them                       |
| Agentgateway                            | Agent/tool proxy authorization and observability              | Whether provider-specific transactional approvals/reconciliation add useful value          | INVESTIGATE integration; no claim of missing capability              |
| OPA / Cedar                             | Mature declarative authorization                              | Current TypeScript rules may suffice; a new engine does not enforce credentials            | DEFER replacement pending measured complexity                        |
| Sigstore / in-toto                      | Authenticity, provenance and verification ecosystem           | Which receipt interoperability customers actually need                                     | Investigate integration after an accepted canonical receipt contract |
| Semgrep / Gitleaks and successors       | Existing scanning and security workflows                      | Evidence composition and action authority, rather than another scanner                     | Adapter evaluation; no immediate replacement                         |

## Differentiator falsification

| Hypothesis / who needs it                        | Concrete failure                                        | Existing answer                                                | What could remain underserved / enforceable boundary                                                    | Disproof                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Exact-action review / platform operator          | Approval used after commit/parameters/policy change     | GitHub protection rules, gateway authorization, policy engines | A tightly scoped provider adapter with independently held credential and atomic context-bound admission | Existing workflow achieves same outcome with less effort; agent retains a bypass credential  |
| Explainable unknown outcome / incident responder | Timeout retried after a successful provider effect      | Provider queries, workflow logs, durable orchestration         | Durable attempt/reference records plus provider reconciliation for a supported operation                | Provider cannot disambiguate safely, or customers do not need the extra evidence             |
| Portable evidence / security reviewer            | Dashboard data altered or separated from action context | Signed attestations and existing audit tools                   | Canonical request/decision/observed-outcome receipt with explicit limitations                           | Existing attestation integration is easier, or operators cannot use independent verification |

## Pilot and interview plan — proposed, not executed

Recruit through owner-authorized channels only. Start with 5–8 relevant teams;
ask for recent concrete incidents, current controls, review burden, credential
placement, bypasses and outcome recovery. Seek teams satisfied with existing tools
as deliberately contrary evidence. Record anonymized repeated problems only with
consent; never collect raw credentials or private repository evidence by default.

Before any live write pilot, require accepted predecessor phases and explicit staging
scope. Compare the same bounded workflow using existing controls and AgentShield.
Measure installation minutes, operator interventions, useful blocks, false positives,
approval wait/active review time, unknown outcomes, recovery time and weekly repeat use.
Measure willingness to pay separately from technical interest.

Proposed initial gates to agree with pilot owners: install within one hour; no
demonstrated credential bypass in the supported flow; successful stale-context blocks;
all injected ambiguous outcomes remain visible and reconcile correctly; at least
three teams use the workflow repeatedly for four weeks. Stop or narrow if existing
controls are simpler/equivalent, direct credentials cannot be removed, useful blocks
are rare, review friction prevents repeat use, or required provider conditions cannot
be enforced. Thresholds are hypotheses, not measured results or commercial promises.

Positioning decision: continue a narrow GitHub exact-action authority experiment
after foundation acceptance. Treat scanning as an integrated evidence source.
Do not claim novelty, production readiness or proven demand from this desk research.
