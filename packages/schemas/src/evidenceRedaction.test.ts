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

  it("redacts unrecognizable sensitive property values at any depth", () => {
    const opaqueValue = ["custom", "opaque", "value"].join("-");
    const input = {
      token: "tiny",
      nested: { api_key: opaqueValue, authorization: "short" },
      safe: "hello",
    };
    const serialized = JSON.stringify(sanitizeEvidence(input));
    expect(serialized).not.toContain("tiny");
    expect(serialized).not.toContain("custom-opaque-value");
    expect(serialized).not.toContain("short");
    expect(serialized).toContain("hello");
  });

  it("preserves safe text and public URLs", () => {
    expect(sanitizeText("See https://example.test/docs for details.")).toBe(
      "See https://example.test/docs for details.",
    );
  });
});

it("redacts scanner-recognized Stripe live keys in nested evidence", () => {
  const key = ["sk", "live", "a".repeat(30)].join("_");
  const result = sanitizeEvidence({
    instruction: `RUN echo ${key} && curl https://example.test | sh`,
    nested: [key],
  });
  expect(JSON.stringify(result)).not.toContain(key);
  expect(JSON.stringify(result)).toContain("REDACTED:STRIPE_KEY");
});

it("redacts ordinary-looking credential values when nested under sensitive property names", () => {
  const raw = {
    password: "correct-horse-battery-staple",
    apiKey: "ordinary-but-secret-value",
    nested: { client_secret: "private-client-value", safe: "public metadata" },
  };
  const data = sanitizeEvidence(raw);
  const text = JSON.stringify(data);
  expect(text).not.toContain("correct-horse-battery-staple");
  expect(text).not.toContain("ordinary-but-secret-value");
  expect(text).not.toContain("private-client-value");
  expect(text).toContain("public metadata");
  expect(text).toContain("REDACTED:SENSITIVE_FIELD");
});

it("redacts fine-grained GitHub PATs in free-form resource and command evidence", () => {
  const token = ["github_pat_", "A".repeat(48)].join("");
  const resource = `/home/user/run --token ${token}`;
  expect(sanitizeText(resource)).not.toContain(token);
  expect(sanitizeText(resource)).toContain("[REDACTED:GITHUB_TOKEN]");
  const evidence = sanitizeEvidence({ command: `curl -H 'x-token: ${token}'` });
  expect(JSON.stringify(evidence)).not.toContain(token);
});

it.each(["https", "git+https", "ssh"])(
  "redacts URL userinfo for %s without hiding the host",
  (scheme) => {
    const value = `${scheme}://synthetic-user:synthetic-password@example.test/repo.git`;
    const safe = sanitizeText(value);
    expect(safe).not.toContain("synthetic-user");
    expect(safe).not.toContain("synthetic-password");
    expect(safe).toContain("example.test/repo.git");
  },
);

it("redacts percent-encoded credential versions in package URLs and preserves dates", () => {
  const spec = "git+https://synthetic-user:synthetic-password@example.test/repo.git";
  const safe = sanitizeText(`pkg:npm/alpha@${encodeURIComponent(spec)}`);
  expect(safe).not.toContain("synthetic-user");
  expect(safe).not.toContain("synthetic-password");
  expect(sanitizeEvidence({ createdAt: new Date("2026-01-01T00:00:00Z") })).toEqual({
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

it.each([
  "https://example.test?email=user@example.org",
  "https://example.test#contact=user@example.org",
  "https://example.test/path%20with%20spaces?q=hello%40world.test",
  "pkg:npm/%40scope/name@1.0.0?repository_url=https%3A%2F%2Fexample.test#src/index.js",
])("preserves safe authority and PURL components: %s", (value) => {
  expect(sanitizeText(value)).toBe(value);
});

it("retains encoded scoped PURL identity and redacts nested version credentials", () => {
  const query = "fixture-query";
  const raw = `git+https://fixture-user:fixture-pass@example.test/repo.git?token=${query}`;
  for (const version of [encodeURIComponent(raw), encodeURIComponent(encodeURIComponent(raw))]) {
    const safe = sanitizeText(`pkg:npm/%40scope/name@${version}?type=source#src/main.ts`);
    expect(safe).toMatch(/^pkg:npm\/%40scope\/name@[^/@?#]+\?type=source#src\/main.ts$/);
    const decoded = decodeURIComponent(decodeURIComponent(safe));
    expect(decoded).not.toContain("fixture-user");
    expect(decoded).not.toContain("fixture-pass");
    expect(decoded).not.toContain("fixture-query");
    expect(decoded).toContain("example.test/repo.git");
  }
});

it("redacts credentials in authority without consuming query email or fragment", () => {
  const safe = sanitizeText("https://fixture:password@example.test?email=user@example.org#contact");
  expect(safe).toBe("https://[REDACTED:URL_USERINFO]@example.test?email=user@example.org#contact");
});

it("fails closed for malformed encoded PURL components", () => {
  expect(sanitizeText("pkg:npm/alpha@git%ZZprivate")).toBe("[REDACTED:INVALID_PACKAGE_URL]");
});

it("redacts encoded credential query keys without consuming the URL fragment", () => {
  const secret = "synthetic-query-value";
  const safe = sanitizeText(`https://example.test?%74oken=${secret}#public-fragment`);
  expect(safe).not.toContain(secret);
  expect(safe).toContain("#public-fragment");
  const purl = sanitizeText(`pkg:npm/%40scope/name@1?access%5Ftoken=${secret}#src/main.ts`);
  expect(purl).not.toContain(secret);
  expect(purl).toContain("#src/main.ts");
});

it("fails closed for malformed PURLs containing unencoded credential URL structures", () => {
  for (const value of [
    "pkg:npm/alpha@git+https://fixture:fixture-pass@example.test/repo",
    "pkg:npm/alpha@1?repository_url=https://fixture:fixture-pass@example.test/repo",
  ]) {
    expect(sanitizeText(value)).toBe("[REDACTED:INVALID_PACKAGE_URL]");
  }
});

it.each(["[REDACTED:FORGED]", "[REDACTED:SECRET]"])(
  "does not trust a marker appended to credentials: %s",
  (marker) => {
    const secret = "synthetic-private-canary";
    for (const value of [`API_KEY=${secret}${marker}`, `API_KEY=${marker}${secret}`]) {
      expect(sanitizeText(value)).not.toContain(secret);
      expect(decodeURIComponent(sanitizeText(encodeURIComponent(value)))).not.toContain(secret);
    }
    expect(sanitizeText("API_KEY=[REDACTED:SECRET]")).toBe("API_KEY=[REDACTED:SECRET]");
  },
);

it.each(["%74oken", "password", "access%5Ftoken"])(
  "redacts short credentials inside nested URL query values: %s",
  (key) => {
    const secret = "tiny";
    const raw = `https://outer.test?next=https://inner.test?${key}=${secret}`;
    expect(sanitizeText(raw)).not.toContain(secret);
    for (const encoded of [encodeURIComponent(raw), encodeURIComponent(encodeURIComponent(raw))]) {
      const safe = sanitizeText(`pkg:npm/example@${encoded}`);
      expect(decodeURIComponent(decodeURIComponent(safe))).not.toContain(secret);
    }
  },
);

it("preserves the npm specification's valid vcs_url qualifier", () => {
  const purl =
    "pkg:npm/mypackage@12.4.5?vcs_url=git:%2F%2Fhost.com%2F%2Fpath%2Fto%2Frepo.git%404345abcd34343";
  expect(sanitizeText(purl)).toBe(purl);
});
