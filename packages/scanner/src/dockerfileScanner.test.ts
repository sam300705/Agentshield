import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { scanFileForSecrets, scanDockerfile } from "./index.js";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("dockerfileScanner", () => {
  it("intercepts file reads and flags a hardcoded AWS key as a CRITICAL violation", async () => {
    const syntheticDockerfile = `
FROM node:20-alpine
ENV AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
USER node
CMD ["node", "index.js"]
`;

    vi.mocked(readFile).mockResolvedValue(syntheticDockerfile);

    const scanInput = {
      scanId: "test-scan-dockerfile",
      targetRoot: "/workspace",
      filePath: "/workspace/Dockerfile",
    };

    const secretFindings = await scanFileForSecrets(scanInput);
    const dockerfileFindings = await scanDockerfile(scanInput);

    const criticalAwsFinding = secretFindings.find(
      (f) => f.severity === "CRITICAL" && f.evidence.ruleId === "secret.aws_access_key_id"
    );

    expect(criticalAwsFinding).toBeDefined();
    expect(criticalAwsFinding?.category).toBe("SECRET");
    expect(criticalAwsFinding?.severity).toBe("CRITICAL");

    expect(dockerfileFindings).toBeDefined();
  });
});
