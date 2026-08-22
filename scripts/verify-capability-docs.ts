import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface CapabilityManifest {
  schemaVersion: number;
  status: string;
  capabilities: Record<string, { status: string; reason?: string; scope?: string }>;
  limitations: string[];
}

const root = resolve(import.meta.dirname, "..");

async function read(relativePath: string): Promise<string> {
  return readFile(resolve(root, relativePath), "utf8");
}

function requireText(document: string, expected: string, source: string): void {
  if (!document.includes(expected)) {
    throw new Error(`${source} is missing required status text: ${expected}`);
  }
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await read("docs/capabilities.json")) as CapabilityManifest;

  if (manifest.schemaVersion !== 1)
    throw new Error("Unsupported capability manifest schema version.");
  if (manifest.status !== "portfolio-prototype-controlled-internal-alpha") {
    throw new Error("Capability manifest must not claim production readiness.");
  }

  const requiredStatuses: Record<string, string> = {
    deterministic_scanner: "implemented_and_verified",
    tenant_scoped_api: "implemented_and_verified",
    oidc_production_authentication: "implemented_requires_configuration",
    azure_container_apps_deployment: "prepared_not_deployed",
    github_app_repository_onboarding: "not_implemented",
  };

  for (const [name, status] of Object.entries(requiredStatuses)) {
    if (manifest.capabilities[name]?.status !== status) {
      throw new Error(`Capability ${name} must have status ${status}.`);
    }
  }

  const readme = await read("README.md");
  const report = await read("docs/implementation-report.md");
  const checklist = await read("docs/MORNING_SETUP_CHECKLIST.md");

  requireText(readme, "## Capability status", "README.md");
  requireText(readme, "Production authentication requires OIDC configuration", "README.md");
  requireText(readme, "The static dashboard is not proof of a deployed API", "README.md");
  requireText(report, "not described as production-ready", "docs/implementation-report.md");
  requireText(checklist, "not yet implemented", "docs/MORNING_SETUP_CHECKLIST.md");

  for (const [source, document] of [
    ["README.md", readme],
    ["docs/implementation-report.md", report],
    ["docs/MORNING_SETUP_CHECKLIST.md", checklist],
  ] as const) {
    if (/fully production[- ]ready|production deployment is complete/i.test(document)) {
      throw new Error(`${source} contains an unsupported production-readiness claim.`);
    }
  }

  console.warn("Capability and documentation consistency check passed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
