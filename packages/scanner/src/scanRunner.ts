import { type Dependency, type Finding } from "@agentshield/schemas";
import path from "node:path";

import { scanAgentWorkflowLog } from "./agentWorkflowScanner.js";
import { generateSbomForPackageJson } from "./dependencyScanner.js";
import { scanDockerfile } from "./dockerfileScanner.js";
import { scanKubernetesManifest } from "./kubernetesScanner.js";
import { walkRepository, type WalkRepositoryOptions } from "./repoWalker.js";
import { scanFileForSecrets } from "./secretScanner.js";

export interface ScanRunnerResult {
  scanId: string;
  targetPath: string;
  findings: Finding[];
  dependencies: Dependency[];
}

const TEXT_FILE_EXTENSIONS = new Set([
  "",
  ".conf",
  ".env",
  ".example",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function isDockerfile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return basename === "dockerfile" || basename.startsWith("dockerfile.");
}

function isYamlFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();

  return extension === ".yaml" || extension === ".yml";
}

function isPackageJson(filePath: string): boolean {
  return path.basename(filePath) === "package.json";
}

function isAgentWorkflowLog(targetRoot: string, filePath: string): boolean {
  const relativePath = path.relative(targetRoot, filePath);
  const pathSegments = relativePath.split(path.sep);

  return pathSegments.includes("agent-logs") && path.extname(filePath).toLowerCase() === ".log";
}

function isLikelyTextFile(filePath: string): boolean {
  if (isDockerfile(filePath)) {
    return true;
  }

  const basename = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();

  return TEXT_FILE_EXTENSIONS.has(extension) || basename.includes(".env");
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    `${left.filePath}:${left.lineStart ?? 0}:${left.fingerprint}`.localeCompare(
      `${right.filePath}:${right.lineStart ?? 0}:${right.fingerprint}`,
    ),
  );
}

export async function runScan(
  targetPath: string,
  scanId: string,
  options: WalkRepositoryOptions = {},
): Promise<ScanRunnerResult> {
  const targetRoot = path.resolve(targetPath);
  const filePaths = await walkRepository(targetRoot, options);
  const findings: Finding[] = [];
  const dependencies: Dependency[] = [];

  for (const filePath of filePaths) {
    if (options.signal?.aborted === true) throw new Error("Scan cancelled");
    const scannerInput = {
      scanId,
      targetRoot,
      filePath,
    };

    if (isLikelyTextFile(filePath)) {
      findings.push(...(await scanFileForSecrets(scannerInput)));
    }

    if (isDockerfile(filePath)) {
      findings.push(...(await scanDockerfile(scannerInput)));
    }

    if (isYamlFile(filePath)) {
      findings.push(...(await scanKubernetesManifest(scannerInput)));
    }

    if (isPackageJson(filePath)) {
      dependencies.push(...(await generateSbomForPackageJson(scannerInput)));
    }

    if (isAgentWorkflowLog(targetRoot, filePath)) {
      findings.push(...(await scanAgentWorkflowLog(scannerInput)));
    }
  }

  return {
    scanId,
    targetPath: targetRoot,
    findings: sortFindings(findings),
    dependencies,
  };
}
