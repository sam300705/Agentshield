export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Decision = "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK";

export interface DemoEvent {
  id: string;
  time: string;
  type: string;
  title: string;
  detail: string;
  resource: string;
  risk: Risk;
  decision?: Decision;
  hash: string;
}

export const demoEvents: DemoEvent[] = [
  {
    id: "evt-001",
    time: "10:42:01",
    type: "TOOL",
    title: "Agent session started",
    detail: "Task: add production telemetry exporter",
    resource: "agent:codex-demo",
    risk: "LOW",
    hash: "67ef3b4a9d12",
  },
  {
    id: "evt-002",
    time: "10:42:04",
    type: "FILE READ",
    title: "Read environment file",
    detail: "Content was redacted before persistence",
    resource: ".env",
    risk: "CRITICAL",
    hash: "d935a8bc18e1",
  },
  {
    id: "evt-003",
    time: "10:42:08",
    type: "SECRET ACCESS",
    title: "Credential signature detected",
    detail: "High-confidence AWS access-key pattern; raw value discarded",
    resource: ".env:3",
    risk: "CRITICAL",
    hash: "ba7a43de5c92",
  },
  {
    id: "evt-004",
    time: "10:42:13",
    type: "DEPENDENCY",
    title: "Dependency manifest changed",
    detail: "Added telemetry exporter package",
    resource: "package.json",
    risk: "MEDIUM",
    hash: "4e929a190b3a",
  },
  {
    id: "evt-005",
    time: "10:42:17",
    type: "SHELL",
    title: "Remote script piped to shell",
    detail: "Command arguments redacted; execution denied by policy",
    resource: "shell",
    risk: "CRITICAL",
    decision: "BLOCK",
    hash: "206ca46622f7",
  },
  {
    id: "evt-006",
    time: "10:42:23",
    type: "INFRA",
    title: "Deployment privileges modified",
    detail: "privileged=true added to container securityContext",
    resource: "k8s/deployment.yaml",
    risk: "CRITICAL",
    hash: "72627361e94c",
  },
  {
    id: "evt-007",
    time: "10:42:24",
    type: "POLICY",
    title: "Production policy blocked change",
    detail: "Rule kubernetes.privileged_container.block@2.4.0",
    resource: "policy:production",
    risk: "CRITICAL",
    decision: "BLOCK",
    hash: "a3031b5a799d",
  },
  {
    id: "evt-008",
    time: "10:42:27",
    type: "APPROVAL",
    title: "Independent review requested",
    detail: "Host-path change requires Security Reviewer role",
    resource: "approval:apr-1842",
    risk: "HIGH",
    decision: "REQUIRE_APPROVAL",
    hash: "9e5bb6372980",
  },
];

export const findings = [
  {
    id: "F-184",
    title: "Credential material accessed",
    file: ".env",
    severity: "CRITICAL" as Risk,
    original: "BLOCK" as Decision,
  },
  {
    id: "F-185",
    title: "Remote content piped to shell",
    file: "agent-logs/session.log",
    severity: "CRITICAL" as Risk,
    original: "REQUIRE_APPROVAL" as Decision,
  },
  {
    id: "F-186",
    title: "Privileged workload introduced",
    file: "k8s/deployment.yaml",
    severity: "CRITICAL" as Risk,
    original: "BLOCK" as Decision,
  },
  {
    id: "F-187",
    title: "Mutable container base tag",
    file: "Dockerfile",
    severity: "HIGH" as Risk,
    original: "WARN" as Decision,
  },
  {
    id: "F-188",
    title: "New production dependency",
    file: "package.json",
    severity: "MEDIUM" as Risk,
    original: "ALLOW" as Decision,
  },
];

export const receipt = {
  id: "ASR-2026-0819-1842",
  repository: "sam300705/Agentshield",
  branch: "agent/recruiter-demo",
  commit: "8d71af0f5e3c",
  scanner: "agentshield-scanner@0.2.0",
  policy: "production@2.4.0",
  started: "2026-08-19T10:42:01.000Z",
  completed: "2026-08-19T10:42:29.000Z",
  findings: { critical: 3, high: 1, medium: 1, low: 0 },
  decisions: { BLOCK: 2, REQUIRE_APPROVAL: 1, WARN: 1, ALLOW: 1 },
  gate: "BLOCK",
  evidenceDigest: "ce3f9bd3da356beb8f288e48980569c9654368d2b9a47a56ab2f523ad18cf487",
  receiptHash: "49e7e4e322b32b754a98bbfc3f56bd3ebd798062031c5ad1b0cf4438c043a9d8",
};

export function simulatePolicy(environment: "development" | "staging" | "production") {
  const simulated = findings.map((finding) => {
    let decision = finding.original;
    if (environment === "development" && finding.original === "BLOCK" && finding.id !== "F-184")
      decision = "REQUIRE_APPROVAL";
    if (environment === "staging" && finding.original === "WARN") decision = "REQUIRE_APPROVAL";
    if (environment === "production" && finding.original === "WARN") decision = "BLOCK";
    if (
      environment === "production" &&
      finding.original === "ALLOW" &&
      finding.severity === "MEDIUM"
    )
      decision = "WARN";
    return { ...finding, simulated: decision };
  });
  const weight: Record<Decision, number> = { ALLOW: 0, WARN: 2, REQUIRE_APPROVAL: 6, BLOCK: 10 };
  const originalRisk = simulated.reduce((sum, item) => sum + weight[item.original], 0);
  const simulatedRisk = simulated.reduce((sum, item) => sum + weight[item.simulated], 0);
  return {
    decisions: simulated,
    riskDelta: simulatedRisk - originalRisk,
    newlyBlocked: simulated.filter(
      (item) => item.simulated === "BLOCK" && item.original !== "BLOCK",
    ).length,
    approvalDelta:
      simulated.filter((item) => item.simulated === "REQUIRE_APPROVAL").length -
      simulated.filter((item) => item.original === "REQUIRE_APPROVAL").length,
  };
}
