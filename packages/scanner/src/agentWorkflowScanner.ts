import {
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

const SECRET_REDACTION_PATTERNS = [
  { regex: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, mask: "[REDACTED_AWS_ACCESS_KEY]" },
  { regex: /(AWS_SECRET_ACCESS_KEY\s*[:=]\s*(?:['"`]?))([A-Za-z0-9/+=]{40})/gi, mask: "$1[REDACTED_AWS_SECRET]" },
  { regex: /\b(gh[pousr]_[A-Za-z0-9_]{20,255})\b/g, mask: "[REDACTED_GITHUB_TOKEN]" },
  { regex: /\b(sk_live_[A-Za-z0-9]{20,255})\b/g, mask: "[REDACTED_STRIPE_KEY]" },
  { regex: /\b(eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, mask: "[REDACTED_JWT]" },
  { regex: /(API_KEY|ADMIN_TOKEN|JWT_SECRET|SECRET_KEY|GITHUB_TOKEN|TOKEN)\s*[:=]\s*(?:['"`]?)([A-Za-z0-9_./+=-]{12,})/gi, mask: "$1=[REDACTED_GENERIC_SECRET]" },
  { regex: /-----BEGIN(?:.*)PRIVATE KEY-----[\s\S]*?-----END(?:.*)PRIVATE KEY-----/g, mask: "[REDACTED_PRIVATE_KEY]" }
];

function redactAgentLogLine(line: string): string {
  let redactedLine = line;
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    redactedLine = redactedLine.replace(pattern.regex, pattern.mask);
  }
  return redactedLine;
}

function toRelativePath(targetRoot: string, filePath: string): string {
  return path.relative(targetRoot, filePath) || path.basename(filePath);
}

function createFingerprint(ruleId: string, relativePath: string, lineNumber: number, line: string): string {
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

      const redactedLine = redactAgentLogLine(line);

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
            logLine: redactedLine, // Store the redacted log line instead of raw output
          },
          fingerprint: createFingerprint(pattern.id, relativePath, lineNumber, line),
          createdAt: new Date(),
        }),
      );
    }
  }

  return findings;
}
