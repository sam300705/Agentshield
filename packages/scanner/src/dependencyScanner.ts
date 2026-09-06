import {
  type Dependency,
  type DependencyScope,
  type PackageManager,
  dependencySchema,
} from "@agentshield/schemas";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface DependencyScannerInput {
  scanId: string;
  targetRoot: string;
  filePath: string;
}

type DependencyField =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

const DEPENDENCY_FIELD_TO_SCOPE: Record<DependencyField, DependencyScope> = {
  dependencies: "PRODUCTION",
  devDependencies: "DEVELOPMENT",
  optionalDependencies: "OPTIONAL",
  peerDependencies: "PEER",
};

function toRelativePath(targetRoot: string, filePath: string): string {
  return path.relative(targetRoot, filePath) || path.basename(filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDependencyRecord(manifest: Record<string, unknown>, field: DependencyField) {
  const value = manifest[field];

  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(manifestPath: string): Promise<PackageManager> {
  const directory = path.dirname(manifestPath);

  if (await fileExists(path.join(directory, "pnpm-lock.yaml"))) {
    return "PNPM";
  }

  if (await fileExists(path.join(directory, "yarn.lock"))) {
    return "YARN";
  }

  if (await fileExists(path.join(directory, "package-lock.json"))) {
    return "NPM";
  }

  return "NPM";
}

function createPackageUrl(
  packageManager: PackageManager,
  packageName: string,
  version: string,
): string {
  const ecosystem = packageManager === "UNKNOWN" ? "npm" : packageManager.toLowerCase();

  return `pkg:${ecosystem}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
}

export async function generateSbomForPackageJson(
  input: DependencyScannerInput,
): Promise<Dependency[]> {
  const content = await readFile(input.filePath, "utf8");
  const parsedManifest: unknown = JSON.parse(content);

  if (!isRecord(parsedManifest)) {
    return [];
  }

  const packageManager = await detectPackageManager(input.filePath);
  const manifestPath = toRelativePath(input.targetRoot, input.filePath);
  const dependencies: Dependency[] = [];

  for (const field of Object.keys(DEPENDENCY_FIELD_TO_SCOPE) as DependencyField[]) {
    const dependencyRecord = readDependencyRecord(parsedManifest, field);

    for (const [packageName, version] of Object.entries(dependencyRecord)) {
      dependencies.push(
        dependencySchema.parse({
          id: randomUUID(),
          scanId: input.scanId,
          packageName,
          version,
          packageManager,
          scope: DEPENDENCY_FIELD_TO_SCOPE[field],
          manifestPath,
          purl: createPackageUrl(packageManager, packageName, version),
          metadata: {
            dependencyField: field,
            source: "SBOM_GENERATOR",
          },
          createdAt: new Date(),
        }),
      );
    }
  }

  return dependencies.sort((left, right) =>
    `${left.manifestPath}:${left.packageName}:${left.version}`.localeCompare(
      `${right.manifestPath}:${right.packageName}:${right.version}`,
    ),
  );
}
