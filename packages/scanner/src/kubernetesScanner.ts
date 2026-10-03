import {
  type Finding,
  type FindingSeverity,
  findingSchema,
} from "@agentshield/schemas";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAllDocuments, type Document, type ParsedNode } from "yaml";

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

  let documents: Document.Parsed<ParsedNode>[];
  try {
    documents = parseAllDocuments(content);
  } catch {
    return []; // Malformed YAML should fail safely
  }

  const containsKubernetesManifest = documents.some((document) => {
    if (document.errors.length > 0) {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const docJson = document.toJSON();
    return isKubernetesDocument(docJson);
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

  // Proper YAML AST parsing to catch missing resource limits
  for (const doc of documents) {
    if (doc.errors.length > 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const docJson = doc.toJSON();
    if (!isKubernetesDocument(docJson)) continue;

    const findContainers = (obj: unknown): Record<string, unknown>[] => {
      let containers: Record<string, unknown>[] = [];
      if (Array.isArray(obj)) {
        for (const item of obj) {
          containers = containers.concat(findContainers(item));
        }
      } else if (isRecord(obj)) {
        if (Array.isArray(obj.containers)) {
          for (const c of obj.containers) {
             if (isRecord(c)) {
               containers.push(c);
             }
          }
        }
        for (const val of Object.values(obj)) {
          containers = containers.concat(findContainers(val));
        }
      }
      return containers;
    };

    const containers = findContainers(docJson);
    for (const container of containers) {
      if (!container.resources) {
        findings.push(
          createKubernetesFinding({
            scanId: input.scanId,
            relativePath,
            ruleId: "kubernetes.missing_resource_limits",
            severity: "HIGH",
            title: "Kubernetes container missing resource limits",
            description: "The container spec does not define resource limits or requests.",
            lineStart: 1, // Fallback line start for AST findings
            evidence: {
              field: "resources",
              value: null,
            },
          }),
        );
      }
    }
  }

  return findings;
}
