import { describe, expect, it } from "vitest";

import { sanitizeEvidence, sanitizeText } from "./evidenceRedaction.js";

describe("evidence redaction", () => {
  it("redacts credentials recursively without changing JSON shape", () => {
    const bearerSecret = ["Bearer", "super-secret-token-12345"].join(" ");
    const querySecret = "query-secret";
    const awsSecret = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const githubSecret = ["ghp_", "123456789012345678901234567890123456"].join("");
    const connectionString = ["postgresql://user", ":password@example.test:5432/app"].join("");
    const raw = {
      command: `curl -H 'Authorization: ${bearerSecret}' https://example.test?token=${querySecret}`,
      nested: {
        aws: awsSecret,
        github: githubSecret,
        database: connectionString,
      },
      values: ["password=do-not-store-this-value", "ordinary text"],
    };

    const sanitized = sanitizeEvidence(raw);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("super-secret-token-12345");
    expect(serialized).not.toContain(querySecret);
    expect(serialized).not.toContain(awsSecret);
    expect(serialized).not.toContain(githubSecret);
    expect(serialized).not.toContain(connectionString);
    expect(serialized).toContain("ordinary text");
    expect(sanitized).toMatchObject({ nested: {}, values: [expect.any(String), "ordinary text"] });
  });

  it("redacts private keys, JWTs, and bearer tokens from text", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "secret-material",
      "-----END PRIVATE KEY-----",
    ].join("");
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "payload", "signature"].join(".");
    const bearer = ["Bearer", "abcdefghijklmnop1234"].join(" ");
    const text = [privateKey, jwt, bearer].join(" ");

    const sanitized = sanitizeText(text);

    expect(sanitized).not.toContain("secret-material");
    expect(sanitized).not.toContain(jwt);
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
