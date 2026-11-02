import { type Dependency, type Finding, type ScanCoverage } from "@agentshield/schemas";
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
  coverage?: ScanCoverage;
  scannedFiles?: string[];
  skippedFiles?: string[];
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
  const skippedFiles: string[] = [];
  let enumeratedFiles = 0;
  let excludedEntries = 0;
  let incompleteChecks = 0;
  const inspectedFiles: string[] = [];
  const filePaths = await walkRepository(targetRoot, {
    ...options,
    // Only explicit caller/operator exclusions are trusted, never checkout-controlled settings.
    ignorePatterns: options.ignorePatterns ?? [],
    onEnumeratedFile: () => {
      enumeratedFiles += 1;
      options.onEnumeratedFile?.();
    },
    onExcluded: (entryPath) => {
      excludedEntries += 1;
      options.onExcluded?.(entryPath);
    },
    onIgnored: (entryPath) => {
      const relative = path.relative(targetRoot, entryPath).split(path.sep).join("/");
      skippedFiles.push(relative);
      options.onIgnored?.(entryPath);
    },
  });
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
      inspectedFiles.push(path.relative(targetRoot, filePath).split(path.sep).join("/"));
      findings.push(...(await scanFileForSecrets(scannerInput)));
    }

    if (isDockerfile(filePath)) {
      findings.push(...(await scanDockerfile(scannerInput)));
    }

    if (isYamlFile(filePath)) {
      findings.push(
        ...(await scanKubernetesManifest({
          ...scannerInput,
          onIncomplete: () => {
            incompleteChecks += 1;
          },
        })),
      );
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
    scannedFiles: inspectedFiles,
    coverage: {
      status:
        incompleteChecks > 0 || excludedEntries > 0 || inspectedFiles.length < filePaths.length
          ? "PARTIAL"
          : "COMPLETE",
      scope:
        "Supported static checks within the observed scope; not proof of safety or complete event capture.",
      enumeratedFiles,
      inspectedFiles: inspectedFiles.length,
      unsupportedFiles: filePaths.length - inspectedFiles.length,
      excludedEntries,
      incompleteChecks,
    },
    skippedFiles: skippedFiles.sort((left, right) => left.localeCompare(right)),
  };
}
