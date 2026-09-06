import { useEffect, useMemo, useState } from "react";

import {
  demoEvents,
  findings,
  receipt,
  simulatePolicy,
  type Decision,
  type Risk,
} from "./lib/demoData";

type View =
  | "overview"
  | "sessions"
  | "findings"
  | "policies"
  | "approvals"
  | "receipts"
  | "behavior"
  | "audit";

const navigation: Array<{ id: View; label: string; glyph: string }> = [
  { id: "overview", label: "Risk overview", glyph: "◇" },
  { id: "sessions", label: "Agent sessions", glyph: "⌁" },
  { id: "findings", label: "Findings", glyph: "△" },
  { id: "policies", label: "Policy time machine", glyph: "◫" },
  { id: "approvals", label: "Approval cockpit", glyph: "✓" },
  { id: "receipts", label: "Security receipts", glyph: "#" },
  { id: "behavior", label: "Behavior drift", glyph: "∿" },
  { id: "audit", label: "Audit explorer", glyph: "≡" },
];

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`badge badge-${tone.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-")}`}>
      {children}
    </span>
  );
}

function RiskBadge({ risk }: { risk: Risk }) {
  return <Badge tone={risk}>{risk}</Badge>;
}
function DecisionBadge({ decision }: { decision: Decision }) {
  return <Badge tone={decision}>{decision.replaceAll("_", " ")}</Badge>;
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className={`stat-card ${tone ?? ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <i />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PageTitle({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {action}
    </section>
  );
}

function Overview({
  onNavigate,
  onReplay,
}: {
  onNavigate: (view: View) => void;
  onReplay: () => void;
}) {
  return (
    <div className="view-stack">
      <section className="hero-row">
        <div>
          <p className="eyebrow">Executive risk overview</p>
          <h1>Security posture, with every decision explainable.</h1>
          <p className="lede">
            AgentShield records what autonomous coding agents attempt, derives causal risk paths
            from stored evidence, and enforces deterministic policy before changes reach production.
          </p>
        </div>
        <button className="primary-action" onClick={onReplay}>
          Replay attack scenario <span>→</span>
        </button>
      </section>
      <section className="stats-grid">
        <Stat label="Platform risk" value="C" detail="↓ 9 points after policy block" tone="risk" />
        <Stat label="Active sessions" value="04" detail="1 requires attention" />
        <Stat label="Blocked actions" value="12" detail="Last 24 hours" />
        <Stat label="Pending approvals" value="03" detail="Oldest: 18 minutes" tone="warning" />
      </section>
      <section className="overview-grid">
        <article className="panel risk-path-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Highest-risk causal path</p>
              <h2>Credential access → production blast radius</h2>
            </div>
            <Badge tone="critical">92 / 100</Badge>
          </div>
          <div className="risk-chain">
            <div>
              <small>01 · OBSERVED</small>
              <b>Read .env</b>
              <span>Credential source</span>
            </div>
            <i>→</i>
            <div>
              <small>02 · CONFIRMED</small>
              <b>Secret signature</b>
              <span>Evidence redacted</span>
            </div>
            <i>→</i>
            <div>
              <small>03 · OBSERVED</small>
              <b>Infra mutation</b>
              <span>Privileged pod</span>
            </div>
            <i>→</i>
            <div className="blocked-node">
              <small>04 · POLICY</small>
              <b>BLOCK</b>
              <span>Rule 2.4.0</span>
            </div>
          </div>
          <button className="text-action" onClick={() => onNavigate("sessions")}>
            Inspect graph evidence →
          </button>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Decision pressure</p>
              <h2>Policy outcomes</h2>
            </div>
            <span className="live-label">Seeded demo</span>
          </div>
          <div className="decision-bars">
            <div>
              <span>Blocked</span>
              <i>
                <em style={{ width: "68%" }} />
              </i>
              <b>12</b>
            </div>
            <div>
              <span>Approval</span>
              <i>
                <em style={{ width: "46%" }} />
              </i>
              <b>8</b>
            </div>
            <div>
              <span>Warned</span>
              <i>
                <em style={{ width: "31%" }} />
              </i>
              <b>5</b>
            </div>
            <div>
              <span>Allowed</span>
              <i>
                <em style={{ width: "86%" }} />
              </i>
              <b>27</b>
            </div>
          </div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Flight recorder</p>
            <h2>Recent agent activity</h2>
          </div>
          <button className="text-action" onClick={() => onNavigate("sessions")}>
            Open session timeline
          </button>
        </div>
        <div className="event-table compact-table">
          {demoEvents
            .slice(-5)
            .reverse()
            .map((event) => (
              <div className="table-row" key={event.id}>
                <span className={`risk-dot ${event.risk.toLowerCase()}`} />
                <time>{event.time}</time>
                <div>
                  <b>{event.title}</b>
                  <small>{event.resource}</small>
                </div>
                <Badge tone={event.type}>{event.type}</Badge>
                <RiskBadge risk={event.risk} />
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function Sessions({ replayCount }: { replayCount: number }) {
  const visibleEvents = replayCount === 0 ? demoEvents : demoEvents.slice(0, replayCount);
  const selected = visibleEvents[visibleEvents.length - 1] ?? demoEvents[0];
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Agent security flight recorder"
        title="Session AS-1842"
        detail="Deterministic demo replay · agent:codex-demo · started 10:42:01"
        action={
          <div className="title-actions">
            <Badge tone={replayCount > 0 && replayCount < demoEvents.length ? "warn" : "block"}>
              {replayCount > 0 && replayCount < demoEvents.length ? "REPLAYING" : "BLOCKED"}
            </Badge>
            <span className="integrity-ok">◆ Chain verified</span>
          </div>
        }
      />
      <div className="session-grid">
        <section className="panel timeline-panel">
          <div className="panel-head">
            <h2>Timeline</h2>
            <span>
              {visibleEvents.length} / {demoEvents.length} events
            </span>
          </div>
          <ol className="timeline">
            {visibleEvents.map((event) => (
              <li key={event.id}>
                <span className={`timeline-marker ${event.risk.toLowerCase()}`} />
                <div className="timeline-time">{event.time}</div>
                <article>
                  <div>
                    <Badge tone={event.type}>{event.type}</Badge>
                    <RiskBadge risk={event.risk} />
                  </div>
                  <h3>{event.title}</h3>
                  <p>{event.detail}</p>
                  <code>{event.resource}</code>
                </article>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel graph-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Causal attack graph</p>
              <h2>Evidence-derived path</h2>
            </div>
            <Badge tone="critical">92 BLAST RADIUS</Badge>
          </div>
          <div
            className="graph-canvas"
            role="img"
            aria-label="Attack path from agent task to blocked production change"
          >
            <div className="graph-node task">
              <small>TASK</small>
              <b>Telemetry exporter</b>
            </div>
            <span>observed order</span>
            <div className="graph-node critical">
              <small>SENSITIVE ACCESS</small>
              <b>.env read</b>
            </div>
            <span>same correlation</span>
            <div className="graph-node critical">
              <small>INFRA CHANGE</small>
              <b>Privileged pod</b>
            </div>
            <span>policy match</span>
            <div className="graph-node blocked">
              <small>DECISION</small>
              <b>BLOCK</b>
            </div>
          </div>
          <div className="evidence-box">
            <div>
              <p className="eyebrow">Selected evidence</p>
              <h3>{selected?.title}</h3>
            </div>
            <dl>
              <div>
                <dt>Resource</dt>
                <dd>{selected?.resource}</dd>
              </div>
              <div>
                <dt>Integrity hash</dt>
                <dd>
                  <code>{selected?.hash}…</code>
                </dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>CONFIRMED</dd>
              </div>
              <div>
                <dt>Why linked</dt>
                <dd>Same stored correlation ID and observed sequence.</dd>
              </div>
            </dl>
          </div>
          <details className="accessible-fallback">
            <summary>Accessible graph relationship list</summary>
            <ol>
              <li>Task preceded sensitive file access by observed session order.</li>
              <li>
                Sensitive access and infrastructure mutation share correlation corr-demo-1842.
              </li>
              <li>Policy rule matched the stored Kubernetes evidence and produced BLOCK.</li>
            </ol>
          </details>
        </section>
      </div>
    </div>
  );
}

function Findings() {
  const [filter, setFilter] = useState("ALL");
  const visible = findings.filter((finding) => filter === "ALL" || finding.severity === filter);
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Findings explorer"
        title="Evidence, not alerts without context."
        detail="Every row links scanner evidence to the exact policy outcome."
      />
      <section className="panel">
        <div className="filter-row">
          <div className="segmented">
            {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((item) => (
              <button
                className={filter === item ? "active" : ""}
                key={item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <span>{visible.length} findings</span>
        </div>
        <div className="findings-table">
          <div className="table-header">
            <span>ID</span>
            <span>Finding</span>
            <span>Resource</span>
            <span>Severity</span>
            <span>Decision</span>
          </div>
          {visible.map((finding) => (
            <div className="finding-row" key={finding.id}>
              <code>{finding.id}</code>
              <div>
                <b>{finding.title}</b>
                <small>Evidence digest available</small>
              </div>
              <code>{finding.file}</code>
              <RiskBadge risk={finding.severity} />
              <DecisionBadge decision={finding.original} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Policies() {
  const [environment, setEnvironment] = useState<"development" | "staging" | "production">(
    "production",
  );
  const [result, setResult] = useState<ReturnType<typeof simulatePolicy> | null>(null);
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Policy time machine"
        title="Ask “what if?” without rewriting history."
        detail="Re-evaluate immutable scan evidence against another versioned bundle. Simulation outputs are stored separately from original decisions."
      />
      <section className="time-machine">
        <article className="panel simulation-controls">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Historical source</p>
              <h2>Scan SCN-1842</h2>
            </div>
            <Badge>IMMUTABLE</Badge>
          </div>
          <label>
            <span>Simulate with environment</span>
            <select
              value={environment}
              onChange={(event) => {
                setEnvironment(event.target.value as typeof environment);
                setResult(null);
              }}
            >
              <option value="development">Development · v2.2.0</option>
              <option value="staging">Staging · v2.3.0</option>
              <option value="production">Production · v2.4.0</option>
            </select>
          </label>
          <button
            className="primary-action full"
            onClick={() => setResult(simulatePolicy(environment))}
          >
            Run deterministic simulation
          </button>
          <div className="rules-note">
            <b>No original records are changed.</b>
            <span>Five condition traces will be evaluated locally.</span>
          </div>
        </article>
        <article className="panel simulation-result">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Counterfactual impact</p>
              <h2>{result == null ? "Ready to simulate" : `${environment} result`}</h2>
            </div>
            {result && (
              <Badge tone={result.riskDelta > 0 ? "critical" : "allow"}>
                {result.riskDelta > 0 ? "+" : ""}
                {result.riskDelta} RISK
              </Badge>
            )}
          </div>
          {result == null ? (
            <div className="empty-visual">
              <span>↺</span>
              <h3>Select a bundle and run</h3>
              <p>The original decisions remain available for side-by-side comparison.</p>
            </div>
          ) : (
            <>
              <div className="impact-grid">
                <Stat
                  label="Newly blocked"
                  value={String(result.newlyBlocked)}
                  detail="Previously permitted or warned"
                />
                <Stat
                  label="Approval delta"
                  value={`${result.approvalDelta >= 0 ? "+" : ""}${result.approvalDelta}`}
                  detail="Reviewer workload"
                />
              </div>
              <div className="simulation-list">
                {result.decisions.map((item) => (
                  <div key={item.id}>
                    <span>
                      <code>{item.id}</code>
                      {item.title}
                    </span>
                    <DecisionBadge decision={item.original} />
                    <b>→</b>
                    <DecisionBadge decision={item.simulated} />
                  </div>
                ))}
              </div>
            </>
          )}
        </article>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Versioned policy studio</p>
            <h2>Promotion history</h2>
          </div>
          <button className="secondary-action">View rule source</button>
        </div>
        <div className="bundle-list">
          <div>
            <span className="bundle-dot active" />
            <div>
              <b>production@2.4.0</b>
              <small>Active · promoted by policy-admin@agentshield.dev</small>
            </div>
            <Badge tone="allow">ACTIVE</Badge>
          </div>
          <div>
            <span className="bundle-dot" />
            <div>
              <b>staging@2.3.0</b>
              <small>14 rules · 42/42 rule tests passing</small>
            </div>
            <Badge>STAGING</Badge>
          </div>
          <div>
            <span className="bundle-dot draft" />
            <div>
              <b>production@2.5.0-rc.1</b>
              <small>Draft · awaiting two reviewers</small>
            </div>
            <Badge tone="warn">DRAFT</Badge>
          </div>
        </div>
      </section>
    </div>
  );
}

function Approvals() {
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Approval cockpit"
        title="Human judgment at the dangerous edge."
        detail="Separation of duties is enforced: the agent or requester cannot approve its own risky action."
        action={
          <Badge tone={status === "PENDING" ? "warn" : status === "APPROVED" ? "allow" : "block"}>
            {status}
          </Badge>
        }
      />
      <section className="approval-layout">
        <article className="panel approval-card">
          <div className="approval-risk">
            <RiskBadge risk="HIGH" />
            <code>APR-1842</code>
          </div>
          <h2>Host filesystem mount requested</h2>
          <p>
            The agent introduced a hostPath volume in <code>k8s/deployment.yaml</code>. Production
            policy requires an independent Security Reviewer.
          </p>
          <dl>
            <div>
              <dt>Requested by</dt>
              <dd>developer:sambhav</dd>
            </div>
            <div>
              <dt>Current persona</dt>
              <dd>security-reviewer:maya</dd>
            </div>
            <div>
              <dt>Matched rule</dt>
              <dd>kubernetes.host_path.require_approval@2.4.0</dd>
            </div>
            <div>
              <dt>Blast radius</dt>
              <dd>Node filesystem · production cluster</dd>
            </div>
          </dl>
          {status === "PENDING" ? (
            <div className="approval-actions">
              <button className="reject-action" onClick={() => setStatus("REJECTED")}>
                Reject change
              </button>
              <button className="approve-action" onClick={() => setStatus("APPROVED")}>
                Approve with audit record
              </button>
            </div>
          ) : (
            <div className={`decision-confirmation ${status.toLowerCase()}`}>
              <b>{status === "APPROVED" ? "Approval recorded" : "Change rejected"}</b>
              <span>Actor, reason, timestamp, and correlation ID appended to the audit trail.</span>
              <button className="text-action" onClick={() => setStatus("PENDING")}>
                Reset seeded demo
              </button>
            </div>
          )}
        </article>
        <aside className="panel duty-panel">
          <p className="eyebrow">Separation of duties</p>
          <h2>Independent review verified</h2>
          <div className="identity-flow">
            <span>developer:sambhav</span>
            <i>≠</i>
            <span>security-reviewer:maya</span>
          </div>
          <ul>
            <li>Security Reviewer role present</li>
            <li>Requester identity differs</li>
            <li>Approval nonce is unused</li>
            <li>Policy snapshot is immutable</li>
          </ul>
        </aside>
      </section>
    </div>
  );
}

function Receipts() {
  const download = () => {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${receipt.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Security receipt"
        title="A deterministic record of the gate."
        detail="SHA-256 makes tampering evident. It does not, by itself, provide identity or non-repudiation."
        action={
          <button className="primary-action" onClick={download}>
            Export JSON ↓
          </button>
        }
      />
      <section className="receipt-card">
        <div className="receipt-brand">
          <span className="logo-mark">A</span>
          <div>
            <b>AGENTSHIELD SECURITY RECEIPT</b>
            <small>{receipt.id}</small>
          </div>
          <Badge tone="block">GATE: BLOCK</Badge>
        </div>
        <div className="receipt-grid">
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{receipt.repository}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{receipt.branch}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>
                <code>{receipt.commit}</code>
              </dd>
            </div>
            <div>
              <dt>Scanner</dt>
              <dd>{receipt.scanner}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{receipt.policy}</dd>
            </div>
            <div>
              <dt>Approval state</dt>
              <dd>PENDING</dd>
            </div>
          </dl>
          <div className="receipt-counts">
            <div>
              <strong>03</strong>
              <span>Critical</span>
            </div>
            <div>
              <strong>01</strong>
              <span>High</span>
            </div>
            <div>
              <strong>02</strong>
              <span>Blocked</span>
            </div>
            <div>
              <strong>01</strong>
              <span>Approval</span>
            </div>
          </div>
        </div>
        <div className="hash-block">
          <span>Evidence digest</span>
          <code>{receipt.evidenceDigest}</code>
          <span>Receipt hash</span>
          <code>{receipt.receiptHash}</code>
        </div>
        <footer>
          <span>Started {receipt.started}</span>
          <span>Completed {receipt.completed}</span>
          <span>Algorithm SHA-256</span>
        </footer>
      </section>
    </div>
  );
}

function Behavior() {
  const metrics = [
    { name: "Sensitive path access", current: 4, baseline: 0.6, max: 5 },
    { name: "High-risk shell patterns", current: 3, baseline: 0.4, max: 4 },
    { name: "Infrastructure mutations", current: 2, baseline: 0.8, max: 4 },
    { name: "Approval frequency", current: 38, baseline: 12, max: 50 },
  ];
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Agent behavior fingerprint"
        title="Drift you can calculate and defend."
        detail="No vague anomaly score: every warning shows its metric, baseline, and threshold."
        action={<Badge tone="warn">3 DRIFT SIGNALS</Badge>}
      />
      <section className="behavior-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Current vs 30-session baseline</p>
              <h2>Transparent thresholds</h2>
            </div>
          </div>
          <div className="metric-list">
            {metrics.map((metric) => (
              <div key={metric.name}>
                <div>
                  <b>{metric.name}</b>
                  <span>
                    Current {metric.current} · baseline {metric.baseline}
                  </span>
                </div>
                <div className="metric-track">
                  <i style={{ width: `${Math.min(100, (metric.baseline / metric.max) * 100)}%` }} />
                  <em style={{ width: `${Math.min(100, (metric.current / metric.max) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="panel drift-reasons">
          <p className="eyebrow">Why AgentShield flagged drift</p>
          <h2>Threshold evidence</h2>
          <div>
            <RiskBadge risk="CRITICAL" />
            <p>
              <b>Sensitive path access = 4</b>
              <span>Above threshold 1.0 (baseline 0.6 × 1.5, minimum 1).</span>
            </p>
          </div>
          <div>
            <RiskBadge risk="HIGH" />
            <p>
              <b>High-risk shell patterns = 3</b>
              <span>Above threshold 1.0 (baseline 0.4 × 1.5, minimum 1).</span>
            </p>
          </div>
          <div>
            <RiskBadge risk="HIGH" />
            <p>
              <b>Approval frequency = 38%</b>
              <span>Above threshold 18% (baseline 12% × 1.5).</span>
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function Audit() {
  return (
    <div className="view-stack">
      <PageTitle
        eyebrow="Immutable audit explorer"
        title="Every security-relevant transition."
        detail="Append-oriented records link actor, action, entity, correlation, and integrity metadata."
        action={<Badge tone="allow">CHAIN VERIFIED</Badge>}
      />
      <section className="panel audit-list">
        {demoEvents
          .slice()
          .reverse()
          .map((event) => (
            <article key={event.id}>
              <span className={`audit-icon ${event.risk.toLowerCase()}`}>{event.type[0]}</span>
              <div>
                <div>
                  <b>{event.title}</b>
                  <RiskBadge risk={event.risk} />
                </div>
                <p>{event.detail}</p>
                <footer>
                  <code>{event.id}</code>
                  <span>actor: agent:codex-demo</span>
                  <span>corr-demo-1842</span>
                  <code>{event.hash}…</code>
                </footer>
              </div>
            </article>
          ))}
      </section>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>("overview");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [replayCount, setReplayCount] = useState(0);
  const [replaying, setReplaying] = useState(false);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!replaying) return;
    if (replayCount >= demoEvents.length) {
      setReplaying(false);
      return;
    }
    const timer = window.setTimeout(() => setReplayCount((count) => count + 1), 500);
    return () => window.clearTimeout(timer);
  }, [replayCount, replaying]);
  const runReplay = () => {
    setReplayCount(1);
    setReplaying(true);
    setView("sessions");
  };
  const results = useMemo<Array<{ label: string; detail: string; view: View }>>(() => {
    if (search.trim().length < 2) return [];
    const searchItems: Array<{ label: string; detail: string; view: View }> = [
      ...demoEvents.map((event) => ({
        label: event.title,
        detail: event.resource,
        view: "sessions" as const,
      })),
      ...findings.map((finding) => ({
        label: finding.title,
        detail: finding.file,
        view: "findings" as const,
      })),
    ];
    return searchItems
      .filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 6);
  }, [search]);
  const content =
    view === "overview" ? (
      <Overview onNavigate={setView} onReplay={runReplay} />
    ) : view === "sessions" ? (
      <Sessions replayCount={replayCount} />
    ) : view === "findings" ? (
      <Findings />
    ) : view === "policies" ? (
      <Policies />
    ) : view === "approvals" ? (
      <Approvals />
    ) : view === "receipts" ? (
      <Receipts />
    ) : view === "behavior" ? (
      <Behavior />
    ) : (
      <Audit />
    );
  return (
    <div className="command-center">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo-mark">A</span>
          <div>
            <b>AgentShield</b>
            <small>CONTROL PLANE</small>
          </div>
        </div>
        <div className="workspace">
          <span>AS</span>
          <div>
            <b>Acme Security</b>
            <small>Production</small>
          </div>
          <i>⌄</i>
        </div>
        <nav>
          {navigation.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              <span>{item.glyph}</span>
              {item.label}
              {item.id === "approvals" && <em>3</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-health">
          <div>
            <span className="health-dot" />
            <b>Demo systems ready</b>
          </div>
          <small>Offline · deterministic fixture</small>
        </div>
        <div className="persona">
          <span>MR</span>
          <div>
            <b>Maya Rao</b>
            <small>Security Reviewer</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setView("overview")}>
            <span className="logo-mark">A</span> AgentShield
          </button>
          <div className="global-search">
            <span>⌕</span>
            <input
              aria-label="Global search"
              placeholder="Search events, findings, policies…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>⌘ K</kbd>
            {results.length > 0 && (
              <div className="search-results">
                {results.map((item) => (
                  <button
                    key={`${item.label}:${item.detail}`}
                    onClick={() => {
                      setView(item.view);
                      setSearch("");
                    }}
                  >
                    <b>{item.label}</b>
                    <span>{item.detail}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="top-actions">
            <span className="demo-chip">DETERMINISTIC DEMO</span>
            <button
              className="icon-action"
              aria-label="Open command palette"
              onClick={() => setPaletteOpen(true)}
            >
              ⌘
            </button>
            <button className="approval-alert" onClick={() => setView("approvals")}>
              <i />3 approvals
            </button>
          </div>
        </header>
        <main id="main-content">{content}</main>
      </div>
      {paletteOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setPaletteOpen(false)}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div>
              <span>⌕</span>
              <input
                placeholder="Jump to a security surface…"
                onKeyDown={(event) => event.key === "Escape" && setPaletteOpen(false)}
              />
            </div>
            <p>COMMANDS</p>
            {navigation.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  setPaletteOpen(false);
                }}
              >
                <span>{item.glyph}</span>
                {item.label}
                <kbd>↵</kbd>
              </button>
            ))}
            <button
              onClick={() => {
                runReplay();
                setPaletteOpen(false);
              }}
            >
              <span>▶</span>Replay recruiter scenario<kbd>R</kbd>
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
