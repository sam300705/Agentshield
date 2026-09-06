import { sanitizeText } from "@agentshield/schemas";

export type AgentShieldOutcome = "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK";
export type GitHubCheckStatus = "queued" | "in_progress" | "completed";
export type GitHubCheckConclusion =
  | "success"
  | "neutral"
  | "action_required"
  | "failure"
  | "cancelled"
  | "timed_out";

export interface GitHubCheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  title: string;
  message: string;
}

export interface GitHubCheckOutput {
  title: string;
  summary: string;
  text?: string;
  annotations?: GitHubCheckAnnotation[];
}

export interface GitHubCheckRunRequest {
  owner: string;
  repository: string;
  name: string;
  headSha: string;
  externalId: string;
  status: GitHubCheckStatus;
  conclusion?: GitHubCheckConclusion;
  detailsUrl?: string;
  output: GitHubCheckOutput;
  startedAt?: Date;
  completedAt?: Date;
}

export interface GitHubChecksClient {
  createCheckRun(request: GitHubCheckRunRequest): Promise<{ id: number; htmlUrl?: string }>;
  updateCheckRun(
    checkRunId: number,
    request: GitHubCheckRunRequest,
  ): Promise<{ id: number; htmlUrl?: string }>;
}

export function mapOutcomeToGitHubConclusion(outcome: AgentShieldOutcome): GitHubCheckConclusion {
  switch (outcome) {
    case "ALLOW":
      return "success";
    case "WARN":
      return "neutral";
    case "REQUIRE_APPROVAL":
      return "action_required";
    case "BLOCK":
      return "failure";
  }
}

export function buildGitHubCheckOutput(input: {
  outcome: AgentShieldOutcome;
  findingCounts: Record<string, number>;
  highestSeverity?: string;
  policyVersion: string;
  scanUrl?: string;
  reportUrl?: string;
}): GitHubCheckOutput {
  const total = Object.values(input.findingCounts).reduce((sum, count) => sum + count, 0);
  const highestSeverity = input.highestSeverity ?? "NONE";
  const summary = sanitizeText(
    `${total} finding${total === 1 ? "" : "s"}; highest severity ${highestSeverity}; policy ${input.policyVersion}.`,
  );
  const links = [input.scanUrl, input.reportUrl].filter((value): value is string => value != null);
  return {
    title: `AgentShield: ${input.outcome}`,
    summary,
    text: sanitizeText(
      links.length > 0
        ? `Details: ${links.join(" | ")}`
        : "No raw evidence is included in this check.",
    ),
  };
}
