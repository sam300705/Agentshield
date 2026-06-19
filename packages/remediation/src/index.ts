import { type Finding, type Remediation, remediationSchema } from "@agentshield/schemas";
import { randomUUID } from "node:crypto";

import { generatePlaybook } from "./playbookGenerator.js";
import { selectRemediationTemplate } from "./templates.js";

export { generatePrComment } from "./commentGenerator.js";
export { generatePlaybook, type RemediationPlaybook } from "./playbookGenerator.js";
export {
  CATEGORY_REMEDIATION_TEMPLATES,
  FALLBACK_REMEDIATION_TEMPLATE,
  SPECIFIC_REMEDIATION_TEMPLATES,
  selectRemediationTemplate,
  type RemediationTemplate,
  type SafeCodeSnippet,
} from "./templates.js";

function renderDetail(playbook: {
  explanation: string;
  fixSuggestion: string;
  prComment: string;
}): string {
  return [
    "Explanation:",
    playbook.explanation,
    "",
    "Fix suggestion:",
    playbook.fixSuggestion,
    "",
    "PR review comment:",
    playbook.prComment,
  ].join("\n");
}

export function generateRemediation(finding: Finding, scanId: string): Remediation {
  if (finding.scanId !== scanId) {
    throw new Error(`Finding ${finding.id} belongs to scan ${finding.scanId}, not ${scanId}`);
  }

  const template = selectRemediationTemplate(finding);
  const playbook = generatePlaybook(finding);

  return remediationSchema.parse({
    id: randomUUID(),
    findingId: finding.id,
    summary: playbook.summary,
    detail: renderDetail(playbook),
    steps: playbook.steps,
    patch: playbook.patchPayload,
    generatedForDecision: template.generatedForDecision,
    createdAt: new Date(),
  });
}
