import { type Finding, type JsonValue } from "@agentshield/schemas";

import { generatePrComment } from "./commentGenerator.js";
import { selectRemediationTemplate, type SafeCodeSnippet } from "./templates.js";
import { validateAst } from "./firewall.js";

export interface RemediationPlaybook {
  templateId: string;
  summary: string;
  explanation: string;
  fixSuggestion: string;
  prComment: string;
  steps: string[];
  safeCodeSnippet?: SafeCodeSnippet;
  patchPayload: JsonValue;
}

function formatCodeSnippet(snippet: SafeCodeSnippet): string {
  const before = snippet.before == null ? "" : `Before:\n\`\`\`${snippet.language}\n${snippet.before}\n\`\`\`\n\n`;

  return `${before}After:\n\`\`\`${snippet.language}\n${snippet.after}\n\`\`\``;
}

function createPatchPayload(playbook: Omit<RemediationPlaybook, "patchPayload">): JsonValue {
  const payload: Record<string, JsonValue> = {
    type: "DETERMINISTIC_REMEDIATION_GUIDANCE",
    templateId: playbook.templateId,
    explanation: playbook.explanation,
    fixSuggestion: playbook.fixSuggestion,
    prComment: playbook.prComment,
  };

  if (playbook.safeCodeSnippet != null) {
    const safeCodeSnippet: Record<string, JsonValue> = {
      language: playbook.safeCodeSnippet.language,
      after: playbook.safeCodeSnippet.after,
    };

    if (playbook.safeCodeSnippet.before != null) {
      safeCodeSnippet.before = playbook.safeCodeSnippet.before;
    }

    payload.safeCodeSnippet = safeCodeSnippet;
  }

  return payload;
}

export async function generatePlaybook(finding: Finding): Promise<RemediationPlaybook> {
  const template = selectRemediationTemplate(finding);

  // Firewall check: if there's a code snippet in bash (or potentially others that look like bash commands),
  // validate it before finalizing the playbook.
  if (template.safeCodeSnippet && (template.safeCodeSnippet.language === "bash" || template.safeCodeSnippet.language === "sh")) {
    await validateAst(template.safeCodeSnippet.after, finding.scanId);
  }

  const prComment = generatePrComment(finding);
  const fixSuggestion =
    template.safeCodeSnippet == null
      ? template.fixSuggestion
      : `${template.fixSuggestion}\n\n${formatCodeSnippet(template.safeCodeSnippet)}`;

  const playbookBase = {
    templateId: template.id,
    summary: template.summary,
    explanation: template.explanation,
    fixSuggestion,
    prComment,
    steps: template.steps,
  };
  const playbookWithoutPatch: Omit<RemediationPlaybook, "patchPayload"> =
    template.safeCodeSnippet == null
      ? playbookBase
      : {
          ...playbookBase,
          safeCodeSnippet: template.safeCodeSnippet,
        };

  return {
    ...playbookWithoutPatch,
    patchPayload: createPatchPayload(playbookWithoutPatch),
  };
}
