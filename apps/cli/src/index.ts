import { Command } from "commander";
import { runScan } from "@agentshield/scanner";
import { evaluateFindings } from "@agentshield/policy-engine";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { type Finding, type PolicyDecision } from "@agentshield/schemas";

function generateSarif(findings: Finding[], decisions: PolicyDecision[]) {
  const sarifFindings = findings.map(finding => {
    const decision = decisions.find(d => d.findingId === finding.id);
    return {
      ruleId: finding.evidence?.ruleId || "unknown",
      message: { text: finding.description },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.filePath },
            region: {
              startLine: finding.lineStart ?? 1,
              endLine: finding.lineEnd ?? 1
            }
          }
        }
      ],
      properties: {
        severity: finding.severity,
        decision: decision?.decision || "UNKNOWN"
      }
    };
  });

  return {
    version: "2.1.0",
    $schema: "http://json.schemastore.org/sarif-2.1.0-rtm.5",
    runs: [
      {
        tool: {
          driver: {
            name: "AgentShield",
            version: "0.1.0",
            rules: []
          }
        },
        results: sarifFindings
      }
    ]
  };
}

export async function runCli(args: string[]) {
  const program = new Command();

  program
    .name("agentshield")
    .description("AgentShield CLI scanner")
    .version("0.1.0");

  program
    .command("scan")
    .description("Scan a repository for risky changes")
    .argument("[path]", "Path to the repository to scan", ".")
    .option("--json", "Output raw JSON findings instead of human-readable text")
    .option("--sarif", "Output SARIF format for CI integration")
    .option("--policy-version <version>", "Policy version to evaluate against", "latest")
    .option("--repo <repo>", "Repository name metadata")
    .option("--revision <rev>", "Repository revision/commit metadata")
    .action(async (targetPath: string, options: { json?: boolean, sarif?: boolean, policyVersion?: string, repo?: string, revision?: string }) => {
      try {
        const scanId = randomUUID();
        const resolvedPath = path.resolve(targetPath);

        // Pass repository context metadata down if we need it (metadata tracking)
        // Currently we just attach it to outputs if needed.
        const scanResult = await runScan(resolvedPath, scanId);
        const decisions = evaluateFindings(scanResult.findings, scanId);

        // Fail on BLOCK or REQUIRE_APPROVAL semantics
        const hasBlock = decisions.some(d => d.decision === "BLOCK" || d.decision === "REQUIRE_APPROVAL");

        if (options.sarif) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(generateSarif(scanResult.findings, decisions), null, 2));
        } else if (options.json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({
            scanId,
            targetPath: resolvedPath,
            findings: scanResult.findings,
            decisions,
            dependencies: scanResult.dependencies
          }, null, 2));
        } else {
          // eslint-disable-next-line no-console
          console.log(`Scan complete for: ${resolvedPath}`);
          // eslint-disable-next-line no-console
          console.log(`Findings: ${scanResult.findings.length}`);
          // eslint-disable-next-line no-console
          console.log(`Dependencies: ${scanResult.dependencies.length}`);

          decisions.forEach(d => {
            if (d.decision === "BLOCK") {
              const finding = scanResult.findings.find(f => f.id === d.findingId);
              // eslint-disable-next-line no-console
              console.log(`[BLOCK] ${finding?.filePath}:${finding?.lineStart} - ${finding?.title}`);
            }
          });

          decisions.forEach(d => {
            if (d.decision === "REQUIRE_APPROVAL") {
              const finding = scanResult.findings.find(f => f.id === d.findingId);
              // eslint-disable-next-line no-console
              console.log(`[REQUIRE_APPROVAL] ${finding?.filePath}:${finding?.lineStart} - ${finding?.title}`);
            }
          });

          if (hasBlock) {
            // eslint-disable-next-line no-console
            console.log("\nStatus: FAILED (Blocking policy violations or Required Approvals detected)");
          } else {
            // eslint-disable-next-line no-console
            console.log("\nStatus: PASSED");
          }
        }

        // Return deterministic exit codes
        if (hasBlock) {
          process.exit(1);
        } else {
          process.exit(0);
        }
      } catch (err) {
        if (!options.json && !options.sarif) {
          console.error("Execution error:", err instanceof Error ? err.message : err);
        }
        process.exit(2);
      }
    });

  await program.parseAsync(args);
}
