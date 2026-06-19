import { evaluateFindings } from "@agentshield/policy-engine";
import { generateRemediation } from "@agentshield/remediation";
import { runScan } from "@agentshield/scanner";
import type { Finding, JsonValue, PolicyDecision } from "@agentshield/schemas";
import path from "node:path";

const SCAN_ID = "verify-integration-scan";
const MINIMUM_FINDINGS = 10;

function printBanner(message: string): void {
  const border = "=".repeat(message.length + 8);

  console.log(`\n${border}`);
  console.log(`=== ${message} ===`);
  console.log(`${border}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function hasFindingCategory(findings: Finding[], category: Finding["category"]): boolean {
  return findings.some((finding) => finding.category === category);
}

function findBlockedSecret(findings: Finding[], decisions: PolicyDecision[]): Finding {
  const decisionsByFindingId = new Map(decisions.map((decision) => [decision.findingId, decision]));
  const blockedSecret = findings.find((finding) => {
    const decision = decisionsByFindingId.get(finding.id);

    return (
      finding.category === "SECRET" &&
      finding.severity === "CRITICAL" &&
      decision?.decision === "BLOCK"
    );
  });

  return (
    blockedSecret ?? fail("Expected at least one critical secret finding with BLOCK decision.")
  );
}

function readStringField(value: JsonValue | null | undefined, key: string): string | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return null;
  }

  const fieldValue = value[key];

  return typeof fieldValue === "string" ? fieldValue : null;
}

async function main(): Promise<void> {
  const targetPath = path.resolve("examples/vulnerable-repo");
  const scanResult = await runScan(targetPath, SCAN_ID);
  const findings = scanResult.findings;

  assertCondition(
    findings.length >= MINIMUM_FINDINGS,
    `Expected at least ${MINIMUM_FINDINGS} findings, received ${findings.length}.`,
  );
  assertCondition(hasFindingCategory(findings, "SECRET"), "Expected at least one SECRET finding.");
  assertCondition(
    hasFindingCategory(findings, "DOCKERFILE"),
    "Expected at least one DOCKERFILE finding.",
  );
  assertCondition(
    hasFindingCategory(findings, "KUBERNETES"),
    "Expected at least one KUBERNETES finding.",
  );
  assertCondition(
    hasFindingCategory(findings, "AGENT_WORKFLOW"),
    "Expected at least one AGENT_WORKFLOW finding.",
  );

  const decisions = evaluateFindings(findings, SCAN_ID);
  assertCondition(
    decisions.length === findings.length,
    `Expected one policy decision per finding. Findings: ${findings.length}; decisions: ${decisions.length}.`,
  );

  const blockedSecret = findBlockedSecret(findings, decisions);
  const remediation = generateRemediation(blockedSecret, SCAN_ID);
  const prComment = readStringField(remediation.patch, "prComment");

  assertCondition(
    prComment != null && prComment.trim().length > 0,
    "Expected blocked secret remediation to include a non-empty PR comment.",
  );

  printBanner("INTEGRATION TEST PASSED");
  console.log(`Target: ${targetPath}`);
  console.log(`Findings: ${findings.length}`);
  console.log(`Dependencies: ${scanResult.dependencies.length}`);
  console.log(`Blocked secret: ${blockedSecret.title}`);
  console.log(`PR comment preview: ${prComment.split("\n")[0]}`);
}

main().catch((error: unknown) => {
  printBanner("INTEGRATION TEST FAILED");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
