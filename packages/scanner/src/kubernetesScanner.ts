import {
  type Finding,
  type FindingSeverity,
  findingSchema,
} from "@agentshield/schemas";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAllDocuments } from "yaml";

export interface KubernetesScannerInput {
  scanId: string;
  targetRoot: string;
  filePath: string;
}

interface KubernetesFindingInput {
  scanId: string;
  relativePath: string;
  ruleId: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  lineStart: number;
  evidence: Record<string, string | number | boolean | null>;
}

function toRelativePath(targetRoot: string, filePath: string): string {
  return path.relative(targetRoot, filePath) || path.basename(filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKubernetesDocument(value: unknown): boolean {
  return isRecord(value) && typeof value.apiVersion === "string" && typeof value.kind === "string";
}

function createFingerprint(ruleId: string, relativePath: string, lineNumber: number, line: string): string {
  const digest = createHash("sha256")
    .update(`${ruleId}:${relativePath}:${lineNumber}:${line}`)
    .digest("hex")
    .slice(0, 24);

  return `kubernetes:${ruleId}:${digest}`;
}

function createKubernetesFinding(input: KubernetesFindingInput): Finding {
  return findingSchema.parse({
    id: randomUUID(),
    scanId: input.scanId,
    category: "KUBERNETES",
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
      input.lineStart,
      JSON.stringify(input.evidence),
    ),
    createdAt: new Date(),
  });
}

export async function scanKubernetesManifest(input: KubernetesScannerInput): Promise<Finding[]> {
  const content = await readFile(input.filePath, "utf8");
  const relativePath = toRelativePath(input.targetRoot, input.filePath);
  const documents = parseAllDocuments(content);
  const containsKubernetesManifest = documents.some((document) => {
    if (document.errors.length > 0) {
      return false;
    }

    return isKubernetesDocument(document.toJSON());
  });

  if (!containsKubernetesManifest) {
    return [];
  }

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (const [lineIndex, rawLine] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();

    if (/^privileged:\s*true\s*$/i.test(line)) {
      findings.push(
        createKubernetesFinding({
          scanId: input.scanId,
          relativePath,
          ruleId: "kubernetes.privileged_container",
          severity: "CRITICAL",
          title: "Kubernetes container runs privileged",
          description: "The manifest enables privileged mode for a container securityContext.",
          lineStart: lineNumber,
          evidence: {
            field: "securityContext.privileged",
            value: true,
          },
        }),
      );
    }

    if (/^allowPrivilegeEscalation:\s*true\s*$/i.test(line)) {
      findings.push(
        createKubernetesFinding({
          scanId: input.scanId,
          relativePath,
          ruleId: "kubernetes.allow_privilege_escalation",
          severity: "HIGH",
          title: "Kubernetes container allows privilege escalation",
          description: "The manifest allows a process to gain more privileges than its parent process.",
          lineStart: lineNumber,
          evidence: {
            field: "securityContext.allowPrivilegeEscalation",
            value: true,
          },
        }),
      );
    }

    if (/^hostPath:\s*$/i.test(line)) {
      findings.push(
        createKubernetesFinding({
          scanId: input.scanId,
          relativePath,
          ruleId: "kubernetes.host_path_volume",
          severity: "HIGH",
          title: "Kubernetes manifest mounts a hostPath volume",
          description: "The manifest uses a hostPath volume, which can expose host filesystem access.",
          lineStart: lineNumber,
          evidence: {
            field: "volumes.hostPath",
            value: true,
          },
        }),
      );
    }
  }

  return findings;
}

