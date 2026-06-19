import type { FindingSeverity, PolicyDecisionType } from "@agentshield/schemas";

const severityClassName: Record<FindingSeverity, string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-700",
  HIGH: "border-orange-200 bg-orange-50 text-orange-700",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-700",
  LOW: "border-slate-200 bg-slate-50 text-slate-600",
};

const decisionClassName: Record<PolicyDecisionType, string> = {
  BLOCK: "border-red-200 bg-red-50 text-red-700",
  REQUIRE_APPROVAL: "border-orange-200 bg-orange-50 text-orange-700",
  WARN: "border-amber-200 bg-amber-50 text-amber-700",
  ALLOW: "border-green-200 bg-green-50 text-green-700",
};

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${severityClassName[severity]}`}
    >
      {severity}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: PolicyDecisionType }) {
  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${decisionClassName[decision]}`}
    >
      {decision.replace("_", " ")}
    </span>
  );
}
