import { type Finding } from "@agentshield/schemas";

import { selectRemediationTemplate } from "./templates.js";

function formatLocation(finding: Finding): string {
  if (finding.lineStart == null) {
    return finding.filePath;
  }

  if (finding.lineEnd != null && finding.lineEnd !== finding.lineStart) {
    return `${finding.filePath}:${finding.lineStart}-${finding.lineEnd}`;
  }

  return `${finding.filePath}:${finding.lineStart}`;
}

export function generatePrComment(finding: Finding): string {
  const template = selectRemediationTemplate(finding);

  return [
    "### AgentShield Security Review",
    "",
    `**Finding:** ${finding.title}`,
    `**Severity:** ${finding.severity}`,
    `**Location:** \`${formatLocation(finding)}\``,
    "",
    template.prComment,
    "",
    "**Required action:**",
    template.fixSuggestion,
  ].join("\n");
}

