import { type Finding, type FindingSeverity, findingSchema } from "@agentshield/schemas";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAllDocuments } from "yaml";

export interface KubernetesScannerInput {
  scanId: string;
  targetRoot: string;
  filePath: string;
  onIncomplete?: () => void;
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

function isKubernetesDocument(value: unknown): boolean {
  return (
    value instanceof Map &&
    typeof value.get("apiVersion") === "string" &&
    typeof value.get("kind") === "string"
  );
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
  // Keep independently valid documents even when another document is incomplete.
  // Never emit parser messages or object-key coercion warnings from untrusted text.
  let incomplete = false;
  const markIncomplete = () => {
    if (!incomplete) input.onIncomplete?.();
    incomplete = true;
  };
  const ranges: Array<readonly [number, number]> = [];
  for (const document of documents) {
    const range = document.range;
    if (range == null) {
      markIncomplete();
      continue;
    }
    const source = content.slice(range[0], range[1]);
    if (document.errors.length > 0) {
      markIncomplete();
      continue;
    }
    // Partial rendering must not hide static fields in otherwise parseable YAML.
    if (document.warnings.length > 0 || /{{|{%/.test(source)) markIncomplete();
    try {
      if (isKubernetesDocument(document.toJS({ mapAsMap: true })))
        ranges.push([range[0], range[1]]);
    } catch {
      markIncomplete();
    }
  }
  if (ranges.length === 0) return [];

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  let offset = 0;
  let rangeIndex = 0;
  for (const [lineIndex, rawLine] of lines.entries()) {
    const lineStartOffset = offset;
    offset += rawLine.length + (content[offset + rawLine.length] === "\r" ? 2 : 1);
    while (ranges[rangeIndex] != null && ranges[rangeIndex]![1] <= lineStartOffset) rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (range == null || lineStartOffset + rawLine.length < range[0]) continue;
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
          description:
            "The manifest allows a process to gain more privileges than its parent process.",
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
          description:
            "The manifest uses a hostPath volume, which can expose host filesystem access.",
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
