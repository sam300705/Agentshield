import { describe, expect, it } from "vitest";

import { sanitizeEvidence, sanitizeText } from "./evidenceRedaction.js";

describe("evidence redaction", () => {
  it("redacts credentials recursively without changing JSON shape", () => {
    const raw = {
      command:
        "curl -H 'Authorization: Bearer super-secret-token-12345' https://example.test?token=query-secret",
      nested: {
        aws: "AKIAIOSFODNN7EXAMPLE",
        github: "ghp_123456789012345678901234567890123456",
        database: "postgresql://user:password@example.test:5432/app",
      },
      values: ["password=do-not-store-this-value", "ordinary text"],
    };

    const sanitized = sanitizeEvidence(raw);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("super-secret-token-12345");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(serialized).not.toContain("ghp_123456789012345678901234567890123456");
    expect(serialized).not.toContain("postgresql://user:password@example.test:5432/app");
    expect(serialized).toContain("ordinary text");
    expect(sanitized).toMatchObject({ nested: {}, values: [expect.any(String), "ordinary text"] });
  });

  it("redacts private keys, JWTs, and bearer tokens from text", () => {
    const text = [
      "-----BEGIN PRIVATE KEY-----secret-material-----END PRIVATE KEY-----",
      "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "Bearer abcdefghijklmnop1234",
    ].join(" ");

    const sanitized = sanitizeText(text);

    expect(sanitized).not.toContain("secret-material");
    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(sanitized).not.toContain("abcdefghijklmnop1234");
    expect(sanitized).toContain("[REDACTED:PRIVATE_KEY]");
    expect(sanitized).toContain("[REDACTED:JWT]");
    expect(sanitized).toContain("[REDACTED:BEARER_TOKEN]");
  });

  it("preserves safe text and public URLs", () => {
    expect(sanitizeText("See https://example.test/docs for details.")).toBe(
      "See https://example.test/docs for details.",
    );
  });
});
