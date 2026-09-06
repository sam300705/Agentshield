import {
  sanitizeText,
  type Finding,
  type FindingSeverity,
  findingSchema,
} from "@agentshield/schemas";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface AgentWorkflowScannerInput {
  scanId: string;
  targetRoot: string;
  filePath: string;
}

interface AgentWorkflowPattern {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  regex: RegExp;
}

const RISKY_AGENT_PATTERNS: AgentWorkflowPattern[] = [
  {
    id: "agent_workflow.read_env_file",
    title: "AI-agent workflow reads an environment file",
    description: "The agent log shows access to a .env file, which may expose local secrets.",
    severity: "HIGH",
    regex: /\b(?:cat|less|more|type)\s+\.env\b|\baction=read_file\s+path=\.env\b/i,
  },
  {
    id: "agent_workflow.chmod_777",
    title: "AI-agent workflow applies world-writable permissions",
    description: "The agent log shows chmod 777 usage, which can weaken repository permissions.",
    severity: "HIGH",
    regex: /\bchmod\s+(?:-[A-Za-z]+\s+)?777\b/i,
  },
  {
    id: "agent_workflow.remote_script_pipe_shell",
    title: "AI-agent workflow pipes a remote script into a shell",
    description: "The agent log shows network content being executed directly by a shell.",
    severity: "HIGH",
    regex: /\b(?:curl|wget)\b.+\|\s*(?:bash|sh)\b/i,
  },
  {
    id: "agent_workflow.read_ssh_material",
    title: "AI-agent workflow reads SSH material",
    description: "The agent log shows access to SSH files or directories.",
    severity: "CRITICAL",
    regex: /(?:\b(?:cat|less|more|type)\s+|path=|read_file\b).*~\/\.ssh\b/i,
  },
];

function toRelativePath(targetRoot: string, filePath: string): string {
  return path.relative(targetRoot, filePath) || path.basename(filePath);
}

function createFingerprint(
  ruleId: string,
  relativePath: string,
  lineNumber: number,
  line: string,
): string {
  const digest = createHash("sha256")
    .update(`${ruleId}:${relativePath}:${lineNumber}:${line}`)
    .digest("hex")
    .slice(0, 24);

  return `agent-workflow:${ruleId}:${digest}`;
}

export async function scanAgentWorkflowLog(input: AgentWorkflowScannerInput): Promise<Finding[]> {
  const content = await readFile(input.filePath, "utf8");
  const relativePath = toRelativePath(input.targetRoot, input.filePath);
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];

  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;

    for (const pattern of RISKY_AGENT_PATTERNS) {
      if (!pattern.regex.test(line)) {
        continue;
      }

      findings.push(
        findingSchema.parse({
          id: randomUUID(),
          scanId: input.scanId,
          category: "AGENT_WORKFLOW",
          severity: pattern.severity,
          title: pattern.title,
          description: pattern.description,
          filePath: relativePath,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          evidence: {
            ruleId: pattern.id,
            logLine: sanitizeText(line),
          },
          fingerprint: createFingerprint(pattern.id, relativePath, lineNumber, line),
          createdAt: new Date(),
        }),
      );
    }
  }

  return findings;
}
