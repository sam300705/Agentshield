import { type Finding, type FindingSeverity, findingSchema } from "@agentshield/schemas";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface DockerfileScannerInput {
  scanId: string;
  targetRoot: string;
  filePath: string;
}

interface DockerfileFindingInput {
  scanId: string;
  relativePath: string;
  ruleId: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  lineStart?: number;
  evidence: Record<string, string | number | boolean | null>;
}

function toRelativePath(targetRoot: string, filePath: string): string {
  return path.relative(targetRoot, filePath) || path.basename(filePath);
}

function createFingerprint(ruleId: string, relativePath: string, evidence: string): string {
  const digest = createHash("sha256")
    .update(`${ruleId}:${relativePath}:${evidence}`)
    .digest("hex")
    .slice(0, 24);

  return `dockerfile:${ruleId}:${digest}`;
}

function createDockerfileFinding(input: DockerfileFindingInput): Finding {
  return findingSchema.parse({
    id: randomUUID(),
    scanId: input.scanId,
    category: "DOCKERFILE",
    severity: input.severity,
    title: input.title,
    description: input.description,
    filePath: input.relativePath,
    lineStart: input.lineStart,
    lineEnd: input.lineStart,
    evidence: {
      ruleId: input.ruleId,
      ...input.evidence,
    },
    fingerprint: createFingerprint(
      input.ruleId,
      input.relativePath,
      JSON.stringify(input.evidence),
    ),
    createdAt: new Date(),
  });
}

export async function scanDockerfile(input: DockerfileScannerInput): Promise<Finding[]> {
  const content = await readFile(input.filePath, "utf8");
  const relativePath = toRelativePath(input.targetRoot, input.filePath);
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];
  const userInstructions: Array<{ value: string; lineNumber: number }> = [];

  for (const [lineIndex, rawLine] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const fromLatestMatch = /^FROM\s+(?<image>\S+:latest)(?:\s|$)/i.exec(line);

    if (fromLatestMatch?.groups?.image != null) {
      findings.push(
        createDockerfileFinding({
          scanId: input.scanId,
          relativePath,
          ruleId: "dockerfile.from_latest",
          severity: "MEDIUM",
          title: "Dockerfile uses a latest tag",
          description:
            "The Dockerfile base image uses :latest instead of a pinned version or digest.",
          lineStart: lineNumber,
          evidence: {
            image: fromLatestMatch.groups.image,
            instruction: line,
          },
        }),
      );
    }

    const userMatch = /^USER\s+(?<user>\S+)/i.exec(line);

    if (userMatch?.groups?.user != null) {
      userInstructions.push({
        value: userMatch.groups.user,
        lineNumber,
      });

      if (userMatch.groups.user.toLowerCase() === "root" || userMatch.groups.user === "0") {
        findings.push(
          createDockerfileFinding({
            scanId: input.scanId,
            relativePath,
            ruleId: "dockerfile.user_root",
            severity: "HIGH",
            title: "Dockerfile runs as root",
            description:
              "The Dockerfile explicitly switches to root for the runtime container user.",
            lineStart: lineNumber,
            evidence: {
              user: userMatch.groups.user,
              instruction: line,
            },
          }),
        );
      }
    }

    if (/\b(?:curl|wget)\b.+\|\s*(?:bash|sh)\b/i.test(line)) {
      findings.push(
        createDockerfileFinding({
          scanId: input.scanId,
          relativePath,
          ruleId: "dockerfile.remote_script_pipe_shell",
          severity: "HIGH",
          title: "Dockerfile executes a remote script through a shell",
          description: "The Dockerfile pipes a network download directly into a shell.",
          lineStart: lineNumber,
          evidence: {
            instruction: line,
          },
        }),
      );
    }
  }

  if (userInstructions.length === 0) {
    findings.push(
      createDockerfileFinding({
        scanId: input.scanId,
        relativePath,
        ruleId: "dockerfile.missing_user",
        severity: "MEDIUM",
        title: "Dockerfile does not declare a non-root runtime user",
        description:
          "No USER instruction was found, so the image may run with the base image default user.",
        evidence: {
          hasUserInstruction: false,
        },
      }),
    );
  }

  return findings;
}
