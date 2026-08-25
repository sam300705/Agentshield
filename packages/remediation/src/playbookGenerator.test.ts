import { describe, expect, it } from "vitest";
import type { Finding } from "@agentshield/schemas";

import { generatePlaybook } from "./playbookGenerator.js";

describe("deterministic remediation", () => {
  it("selects a secret-specific playbook without including evidence values", () => {
    const finding: Finding = {
      id: "f-1",
      scanId: "s-1",
      category: "SECRET",
      severity: "CRITICAL",
      title: "AWS key",
      description: "Key found",
      filePath: ".env",
      lineStart: 1,
      lineEnd: 1,
      evidence: { ruleId: "secret.aws_access_key_id", matchedText: "AKIA...[REDACTED]" },
      fingerprint: "fp",
      createdAt: new Date(),
    };
    const playbook = generatePlaybook(finding);
    expect(playbook.templateId).toBe("secret.aws_access_key_id");
    expect(playbook.steps).toContain(
      "Rotate the credential if it was ever real or copied from a real environment.",
    );
    expect(JSON.stringify(playbook)).not.toContain("AKIA...[REDACTED]");
  });
});
