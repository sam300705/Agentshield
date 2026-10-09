import { generateKeyPair, exportPKCS8 } from "jose";
import { describe, expect, it, vi } from "vitest";

import { FetchGitHubAppClient } from "./githubApiClient.js";
import {
  buildGitHubCheckOutput,
  mapOutcomeToGitHubConclusion,
  type GitHubCheckRunRequest,
} from "./githubChecks.js";

describe("GitHub Checks adapter", () => {
  it("maps policy outcomes to actionable GitHub conclusions", () => {
    expect(mapOutcomeToGitHubConclusion("ALLOW")).toBe("success");
    expect(mapOutcomeToGitHubConclusion("WARN")).toBe("neutral");
    expect(mapOutcomeToGitHubConclusion("REQUIRE_APPROVAL")).toBe("action_required");
    expect(mapOutcomeToGitHubConclusion("BLOCK")).toBe("failure");
  });

  it("builds a concise output without raw evidence", () => {
    const output = buildGitHubCheckOutput({
      outcome: "BLOCK",
      findingCounts: { CRITICAL: 2, HIGH: 1 },
      highestSeverity: "CRITICAL",
      policyVersion: "production@2.4.0",
      scanUrl: "https://control-plane.example/scans/scan-1",
    });

    expect(output.title).toBe("AgentShield: BLOCK");
    expect(output.summary).toContain("3 findings");
    expect(output.text).not.toContain("secret");
  });

  it("uses an explicit installation token for Check API calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ id: 77, html_url: "https://github.com/acme/project/runs/77" }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const client = new FetchGitHubAppClient(
      { appId: "42", clientId: "client", webhookSecret: "webhook", privateKey: privateKeyPem },
      { fetchImpl, apiBaseUrl: "https://api.example.test" },
    ).withInstallationToken("installation-token");
    const request: GitHubCheckRunRequest = {
      owner: "acme",
      repository: "project",
      name: "AgentShield",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      externalId: "scan-1",
      status: "completed",
      conclusion: "failure",
      output: { title: "AgentShield", summary: "Blocked by policy." },
    };

    await expect(client.createCheckRun(request)).resolves.toMatchObject({ id: 77 });
    const calls = fetchImpl.mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe("https://api.example.test/repos/acme/project/check-runs");
    expect(init).toMatchObject({ method: "POST" });
    const headers = init?.headers;
    expect(headers).toMatchObject({
      Authorization: "Bearer installation-token",
      "X-GitHub-Api-Version": "2026-03-10",
    });
  });
});
