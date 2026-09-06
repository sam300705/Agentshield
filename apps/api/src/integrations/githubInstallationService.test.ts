import { describe, expect, it } from "vitest";

import { normalizeGitHubRepository } from "./githubInstallationService.js";

describe("GitHub repository normalization", () => {
  it("creates stable provider-neutral repository identity", () => {
    expect(
      normalizeGitHubRepository({
        id: 123,
        fullName: "acme/project",
        private: true,
        defaultBranch: null,
        permissions: { admin: true, push: true, pull: true },
      }),
    ).toEqual({
      provider: "GITHUB",
      externalId: "123",
      fullName: "acme/project",
      defaultBranch: "main",
    });
  });
});
