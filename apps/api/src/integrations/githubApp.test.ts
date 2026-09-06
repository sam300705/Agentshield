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

describe("GitHub App webhook boundary", () => {
  it("verifies a raw payload and normalizes its tenant context", () => {
    const body = payload();
    const guard = new WebhookReplayGuard();
    const webhook = parseVerifiedGitHubWebhook(
      body,
      {
        signature: signature(body, "synthetic-secret"),
        delivery: "delivery-1",
        event: "installation",
      },
      "synthetic-secret",
      guard,
    );

    expect(webhook).toMatchObject({
      deliveryId: "delivery-1",
      eventName: "installation",
      installationId: 123,
      organizationLogin: "acme-security",
      repositoryFullName: "acme-security/example",
    });
  });

  it("rejects invalid signatures and replayed deliveries", () => {
    const body = payload();
    const guard = new WebhookReplayGuard();
    const headers = {
      signature: signature(body, "wrong-secret"),
      delivery: "delivery-1",
      event: "push",
    };

    expect(verifyGitHubWebhookSignature(body, headers.signature, "synthetic-secret")).toBe(false);
    expect(() => parseVerifiedGitHubWebhook(body, headers, "synthetic-secret", guard)).toThrow(
      "signature verification failed",
    );

    const validHeaders = { ...headers, signature: signature(body, "synthetic-secret") };
    parseVerifiedGitHubWebhook(body, validHeaders, "synthetic-secret", guard);
    expect(() => parseVerifiedGitHubWebhook(body, validHeaders, "synthetic-secret", guard)).toThrow(
      "already been processed",
    );
  });

  it("denies cross-organization installation context", () => {
    const body = payload();
    const webhook = parseVerifiedGitHubWebhook(
      body,
      {
        signature: signature(body, "synthetic-secret"),
        delivery: "delivery-2",
        event: "installation",
      },
      "synthetic-secret",
      new WebhookReplayGuard(),
    );

    expect(() =>
      assertInstallationOwnership(
        { organizationId: "org-b", installationId: 123, accountLogin: "other-org" },
        webhook,
      ),
    ).toThrow("does not belong to the organization context");
  });

  it("rejects webhook payloads without installation context", () => {
    const body = Buffer.from(JSON.stringify({ action: "push" }));
    expect(() =>
      parseVerifiedGitHubWebhook(
        body,
        { signature: signature(body, "synthetic-secret"), delivery: "delivery-3", event: "push" },
        "synthetic-secret",
        new WebhookReplayGuard(),
      ),
    ).toThrow("installation context is required");
  });
});
