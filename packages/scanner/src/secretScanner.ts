import { type Finding, type FindingSeverity, findingSchema } from "@agentshield/schemas";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface SecretPattern {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  regex: RegExp;
}

export interface SecretScannerInput {
  scanId: string;
  targetRoot: string;
  filePath: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "secret.aws_access_key_id",
    title: "High-confidence AWS access key id detected",
    description:
      "A value matching the AWS access key id format was found in source-controlled text.",
    severity: "CRITICAL",
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: "secret.aws_secret_access_key",
    title: "High-confidence AWS secret access key detected",
    description:
      "An explicit AWS_SECRET_ACCESS_KEY assignment was found in source-controlled text.",
    severity: "CRITICAL",
    regex: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i,
  },
  {
    id: "secret.github_token",
    title: "High-confidence GitHub token detected",
    description: "A value matching a GitHub token prefix was found in source-controlled text.",
    severity: "CRITICAL",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/,
  },
  {
    id: "secret.stripe_live_key",
    title: "High-confidence Stripe live secret key detected",
    description:
      "A value matching a Stripe live secret key prefix was found in source-controlled text.",
    severity: "CRITICAL",
    regex: /\bsk_live_[A-Za-z0-9]{20,255}\b/,
  },
  {
    id: "secret.jwt_token",
    title: "JWT-like bearer token detected",
    description: "A token with a standard JWT header prefix was found in source-controlled text.",
    severity: "HIGH",
    regex: /\beyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  },
  {
    id: "secret.explicit_generic_key",
    title: "Explicit hardcoded secret-like assignment detected",
    description:
      "An explicit key, token, or secret assignment with a long literal value was found.",
    severity: "HIGH",
    regex:
      /\b(?:API_KEY|ADMIN_TOKEN|JWT_SECRET|SECRET_KEY|GITHUB_TOKEN|TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}["']?/i,
  },
];

function toRelativePath(targetRoot: string, filePath: string): string {
  return path.relative(targetRoot, filePath) || path.basename(filePath);
}

function redact(value: string): string {
  if (value.length <= 8) {
    return "[REDACTED]";
  }

  return `${value.slice(0, 4)}...[REDACTED]...${value.slice(-4)}`;
}

function createFingerprint(
  ruleId: string,
  relativePath: string,
  lineNumber: number,
  match: string,
): string {
  const digest = createHash("sha256")
    .update(`${ruleId}:${relativePath}:${lineNumber}:${match}`)
    .digest("hex")
    .slice(0, 24);

  return `secret:${ruleId}:${digest}`;
}

export async function scanFileForSecrets(input: SecretScannerInput): Promise<Finding[]> {
  const content = await readFile(input.filePath, "utf8");
  const relativePath = toRelativePath(input.targetRoot, input.filePath);
  const findings: Finding[] = [];

  // v1 intentionally omits entropy checks to avoid noisy false positives in the portfolio demo.
  const lines = content.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;

    for (const pattern of SECRET_PATTERNS) {
      const match = pattern.regex.exec(line);

      if (match?.[0] == null) {
        continue;
      }

      findings.push(
        findingSchema.parse({
          id: randomUUID(),
          scanId: input.scanId,
          category: "SECRET",
          severity: pattern.severity,
          title: pattern.title,
          description: pattern.description,
          filePath: relativePath,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          evidence: {
            ruleId: pattern.id,
            matchedText: redact(match[0]),
          },
          fingerprint: createFingerprint(pattern.id, relativePath, lineNumber, match[0]),
          createdAt: new Date(),
        }),
      );
    }
  }

  return findings;
}
