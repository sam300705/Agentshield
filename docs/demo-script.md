# Recruiter Demo Scripts

## 90-second version

1. **0:00–0:15 — Thesis.** “AgentShield is a flight recorder and deterministic policy firewall for code changed by autonomous agents.” Point to Platform Risk `C`, blocks, and approvals.
2. **0:15–0:35 — Replay.** Select **Replay attack scenario**. Explain that the session events are a labelled offline fixture: `.env` access, a remote-shell attempt, and a privileged Kubernetes edit.
3. **0:35–0:55 — Causality.** Point to the Attack Graph. Confirmed edges share stored correlation evidence; inferred edges are labelled. Open the accessible relationship list and explain the blast-radius formula.
4. **0:55–1:10 — Time Machine.** Select Production and run the simulation. Show the Docker warning becoming a block while original decisions remain immutable.
5. **1:10–1:20 — Human control.** Open Approval Cockpit. Show different requester/reviewer identities and record a decision.
6. **1:20–1:30 — Receipt.** Export the Security Receipt. Close with: “The core works without an LLM; deterministic evidence remains authoritative.”

## Five-minute technical version

### 0:00–0:45 — Threat and boundaries

Explain that untrusted repository content is scanned but never executed. Secret evidence is redacted before persistence. The scanner applies path, symlink, byte, file-count, and timeout limits.

### 0:45–1:45 — Flight Recorder and graph

Replay the scenario. Each normalized event has actor, source, type, risk, resource, correlation ID, sequence, and SHA-256 chain metadata. Explain that the hash chain detects tampering but is not a signature. Walk the graph and show why each edge exists.

### 1:45–2:40 — Deterministic policy

Open Findings, then Policy Time Machine. Rules are versioned declarative objects. Simulation evaluates the same findings against another bundle, emits condition traces and workload/risk deltas, and never updates original decisions.

### 2:40–3:25 — Approval and identity

Open Approval Cockpit. The API maps roles to permissions and checks them server-side. A Security Reviewer still cannot approve an action when their actor ID equals `requestedBy`. Approval state and audit records are transactional.

### 3:25–4:05 — Worker and CLI

Explain the PostgreSQL job state machine: idempotent enqueue, conditional claim, progress, cancellation, three attempts, and capped exponential backoff. Show CLI help and the exit-code table. Mention JSONL for pipelines and SARIF for GitHub code scanning.

### 4:05–4:40 — Receipts and drift

Export a receipt and show evidence/receipt digests. Open Behavior Drift and show current, baseline, and `baseline × 1.5` threshold for each warning.

### 4:40–5:00 — Honest close

Production still needs OIDC, signed receipts if non-repudiation matters, object-store retention, GitHub App webhook verification, and deployment benchmarks. The architecture keeps those boundaries explicit instead of simulating them.
