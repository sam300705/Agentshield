import { expect, it, vi } from "vitest";
import { FetchGitHubAppClient } from "./githubApiClient.js";
import type { GitHubAppConfig } from "./githubApp.js";
function fixture(lastPageSize: number) {
  const fetchImpl = vi.fn((input: string | URL | Request) => {
    const page = Number(
      new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ).searchParams.get("page"),
    );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          repositories: Array.from({ length: page === 10 ? lastPageSize : 100 }, (_, index) => ({
            id: page * 100 + index,
            full_name: `synthetic/repo-${page}-${index}`,
            private: true,
            default_branch: "main",
          })),
        }),
      ),
    );
  });
  const client = new FetchGitHubAppClient({} as GitHubAppConfig, { fetchImpl });
  return { client, fetchImpl };
}
it("refuses a full tenth page instead of claiming complete repository synchronization", async () => {
  const { client, fetchImpl } = fixture(100);
  await expect(client.listInstallationRepositories(1, "synthetic")).rejects.toThrow(
    "GITHUB_REPOSITORY_LIMIT_EXCEEDED",
  );
  expect(fetchImpl).toHaveBeenCalledTimes(10);
});
it("accepts an explicitly complete final page within the pagination budget", async () => {
  const { client, fetchImpl } = fixture(99);
  expect(await client.listInstallationRepositories(1, "synthetic")).toHaveLength(999);
  expect(fetchImpl).toHaveBeenCalledTimes(10);
});
