import { expect, it } from "vitest";
import { dependencySchema } from "@agentshield/schemas";
import { consolidateDependencies } from "./scanService.js";

it("selects source metadata independently of random occurrence IDs and ordering", () => {
  const base = dependencySchema.parse({
    id: "base",
    scanId: "scan",
    packageName: "alpha",
    version: "1.0.0",
    packageManager: "NPM",
    scope: "PRODUCTION",
    manifestPath: "package.json",
    createdAt: new Date(),
  });
  for (const ids of [
    ["a", "z"],
    ["z", "a"],
  ]) {
    const prod = {
      ...base,
      id: ids[0]!,
      metadata: { dependencyField: "dependencies", source: "SBOM_GENERATOR" },
    };
    const dev = {
      ...base,
      id: ids[1]!,
      scope: "DEVELOPMENT" as const,
      metadata: { dependencyField: "devDependencies", source: "SBOM_GENERATOR" },
    };
    for (const rows of [
      [prod, dev],
      [dev, prod],
    ]) {
      const result = consolidateDependencies(rows)[0]!;
      expect(result.scope).toBe("PRODUCTION");
      expect(result.metadata).toEqual({
        dependencyField: "dependencies",
        source: "SBOM_GENERATOR",
        consolidatedOccurrences: 2,
        observedScopes: ["DEVELOPMENT", "PRODUCTION"],
        dependencyFields: ["dependencies", "devDependencies"],
      });
    }
  }
});
