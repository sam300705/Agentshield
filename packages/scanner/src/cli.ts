#!/usr/bin/env node
/* eslint-disable no-console -- CLI output is the intended public interface. */
import { createSecurityReceipt } from "@agentshield/policy-engine";
import { evaluateFindings, POLICY_RULE_VERSION } from "@agentshield/policy-engine";
import type { Finding, PolicyDecision, PolicyDecisionType } from "@agentshield/schemas";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";

import { runScan } from "./scanRunner.js";
import { gateResult } from "./cliGate.js";

const CLI_VERSION = "0.2.0";
const EXIT_CODES: Record<PolicyDecisionType | "INTERNAL_FAILURE", number> = {
  ALLOW: 0,
  WARN: 1,
  REQUIRE_APPROVAL: 2,
  BLOCK: 3,
  INTERNAL_FAILURE: 4,
};

function sarif(findings: Finding[], decisions: PolicyDecision[]) {
  const decisionByFinding = new Map(decisions.map((decision) => [decision.findingId, decision]));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "AgentShield",
            version: CLI_VERSION,
            informationUri: "https://github.com/sam300705/Agentshield",
            rules: [
              ...new Map(
                decisions.map((decision) => [
                  decision.ruleId,
                  {
                    id: decision.ruleId,
                    name: decision.ruleId,
                    shortDescription: { text: decision.reason },
                  },
                ]),
              ).values(),
            ],
          },
        },
        results: findings.map((finding) => ({
          ruleId: decisionByFinding.get(finding.id)?.ruleId,
          level:
            finding.severity === "CRITICAL" || finding.severity === "HIGH"
              ? "error"
              : finding.severity === "MEDIUM"
                ? "warning"
                : "note",
          message: { text: finding.description },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.filePath },
                region: {
                  startLine: finding.lineStart ?? 1,
                  endLine: finding.lineEnd ?? finding.lineStart ?? 1,
                },
              },
            },
          ],
          fingerprints: { agentshield: finding.fingerprint },
        })),
      },
    ],
  };
}

function printHuman(
  target: string,
  findings: Finding[],
  decisions: PolicyDecision[],
  gate: PolicyDecisionType,
  receiptHash: string,
): void {
  console.log(
    `AgentShield ${CLI_VERSION}\nTarget: ${target}\nGate: ${gate}\nFindings: ${findings.length}`,
  );
  const decisionByFinding = new Map(decisions.map((decision) => [decision.findingId, decision]));
  for (const finding of findings)
    console.log(
      `${finding.severity.padEnd(8)} ${decisionByFinding.get(finding.id)?.decision.padEnd(16) ?? "UNKNOWN"} ${finding.filePath}:${finding.lineStart ?? 1} ${finding.title}`,
    );
  console.log(`Receipt: ${receiptHash}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      path: { type: "string", short: "p", default: process.cwd() },
      format: { type: "string", short: "f", default: "human" },
      policy: { type: "string", default: POLICY_RULE_VERSION },
      ignore: { type: "string", multiple: true, default: [] },
      "max-files": { type: "string", default: "10000" },
      "max-bytes": { type: "string", default: String(100 * 1024 * 1024) },
      timeout: { type: "string", default: "30000" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "AgentShield scanner\n\nUsage: agentshield --path <repo> [--format human|json|jsonl|sarif]\n\nOptions:\n  -p, --path       Repository path\n  -f, --format     Output format\n      --policy     Policy bundle version\n      --ignore     Relative path prefix (repeatable)\n      --max-files  Maximum traversed files\n      --max-bytes  Maximum total bytes\n      --timeout    Timeout in milliseconds\n\nExit codes: 0 ALLOW, 1 WARN, 2 REQUIRE_APPROVAL, 3 BLOCK, 4 internal failure",
    );
    return;
  }
  const format = values.format;
  if (!new Set(["human", "json", "jsonl", "sarif"]).has(format))
    throw new Error(`Unsupported format: ${format}`);
  const target = path.resolve(values.path);
  const scanId = `cli-${createHash("sha256").update(`${target}:${CLI_VERSION}`).digest("hex").slice(0, 20)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(values.timeout));
  const startedAt = new Date();
  try {
    const result = await runScan(target, scanId, {
      ignorePatterns: values.ignore,
      maxFiles: Number(values["max-files"]),
      maxTotalBytes: Number(values["max-bytes"]),
      signal: controller.signal,
    });
    const decisions = evaluateFindings(result.findings, scanId);
    const gate = gateResult(decisions);
    const completedAt = new Date();
    const findingCounts = Object.fromEntries(
      ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((severity) => [
        severity,
        result.findings.filter((finding) => finding.severity === severity).length,
      ]),
    );
    const decisionCounts = Object.fromEntries(
      ["ALLOW", "WARN", "REQUIRE_APPROVAL", "BLOCK"].map((decision) => [
        decision,
        decisions.filter((item) => item.decision === decision).length,
      ]),
    );
    const receipt = createSecurityReceipt({
      id: `receipt-${scanId}`,
      scanId,
      repository: path.basename(target),
      branch: process.env.GITHUB_HEAD_REF ?? "local",
      commitSha: process.env.GITHUB_SHA ?? "local-worktree",
      scannerVersion: CLI_VERSION,
      policyBundleVersion: values.policy,
      findingCounts,
      decisionCounts,
      approvalState: gate === "REQUIRE_APPROVAL" ? "PENDING" : "NOT_REQUIRED",
      evidence: result.findings.map((finding) => finding.fingerprint),
      startedAt,
      completedAt,
      gateResult: gate,
    });
    if (format === "human")
      printHuman(target, result.findings, decisions, gate, receipt.receiptHash);
    else if (format === "sarif")
      console.log(JSON.stringify(sarif(result.findings, decisions), null, 2));
    else if (format === "jsonl") {
      for (const finding of result.findings)
        console.log(
          JSON.stringify({
            type: "finding",
            finding,
            decision: decisions.find((item) => item.findingId === finding.id),
          }),
        );
      console.log(JSON.stringify({ type: "summary", gate, receipt }));
    } else
      console.log(
        JSON.stringify(
          {
            scanId,
            target,
            findings: result.findings,
            decisions,
            dependencies: result.dependencies,
            gate,
            receipt,
          },
          null,
          2,
        ),
      );
    process.exitCode = EXIT_CODES[gate];
  } finally {
    clearTimeout(timeout);
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error: unknown) => {
    console.error(
      `AgentShield failed safely: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    process.exitCode = EXIT_CODES.INTERNAL_FAILURE;
  });
