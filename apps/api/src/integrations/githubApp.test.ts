import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertInstallationOwnership,
  parseVerifiedGitHubWebhook,
  verifyGitHubWebhookSignature,
  WebhookReplayGuard,
} from "./githubApp.js";

function signature(payload: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function payload(): Buffer {
  return Buffer.from(
    JSON.stringify({
      action: "created",
      installation: { id: 123 },
      organization: { login: "acme-security" },
      repository: { full_name: "acme-security/example" },
    }),
  );
}

function headers(body: Buffer, event: string, delivery: string) {
  return {
    "x-hub-signature-256": signature(body, "synthetic-secret"),
    "x-github-delivery": delivery,
    "x-github-event": event,
  };
}

describe("GitHub App webhook boundary", () => {
  it("verifies a raw payload and normalizes its tenant context", () => {
    const body = payload();
    const webhook = parseVerifiedGitHubWebhook(
      headers(body, "installation", "delivery-1"),
      body,
      "synthetic-secret",
    );

    expect(webhook).toMatchObject({
      deliveryId: "delivery-1",
      eventName: "installation",
      installationId: 123,
      organizationLogin: "acme-security",
      repositoryFullName: "acme-security/example",
    });
  });

  it("rejects invalid signatures and keeps replay tracking as a separate boundary", () => {
    const body = payload();
    const invalidHeaders = {
      ...headers(body, "push", "delivery-1"),
      "x-hub-signature-256": signature(body, "wrong-secret"),
    };

    expect(
      verifyGitHubWebhookSignature(
        body,
        invalidHeaders["x-hub-signature-256"],
        "synthetic-secret",
      ),
    ).toBe(false);
    expect(() => parseVerifiedGitHubWebhook(invalidHeaders, body, "synthetic-secret")).toThrow(
      "Invalid GitHub webhook signature",
    );

    const guard = new WebhookReplayGuard();
    expect(guard.accept("delivery-1", 1_000)).toBe(true);
    expect(guard.accept("delivery-1", 1_001)).toBe(false);
    expect(guard.accept("delivery-1", 1_000 + 15 * 60_000 + 1)).toBe(true);
  });

  it("denies cross-organization installation context", () => {
    const body = payload();
    const webhook = parseVerifiedGitHubWebhook(
      headers(body, "installation", "delivery-2"),
      body,
      "synthetic-secret",
    );

    expect(() =>
      assertInstallationOwnership(
        { organizationId: "org-b", installationId: 123, accountLogin: "other-org" },
        webhook,
      ),
    ).toThrow("GitHub webhook organization does not match the registered installation");
  });

  it("rejects webhook payloads without installation context", () => {
    const body = Buffer.from(JSON.stringify({ action: "push" }));
    expect(() =>
      parseVerifiedGitHubWebhook(
        headers(body, "push", "delivery-3"),
        body,
        "synthetic-secret",
      ),
    ).toThrow("installation context is required");
  });
});
