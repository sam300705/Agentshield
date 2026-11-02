import { describe, expect, it } from "vitest";
import { verifyAuthorityJson } from "./authorityJson.js";

describe("authority JSON ambiguity boundary", () => {
  it("preserves quoted whitespace, escapes and UTF-8 while accepting structural whitespace", () => {
    const value = {
      reason: 'review "quoted" \\ path café\nkept',
      parameters: { targetMustBeAbsent: true },
    };
    expect(() => verifyAuthorityJson(Buffer.from(JSON.stringify(value, null, 2)))).not.toThrow();
  });
  it.each([
    '{"parameters":{"targetMustBeAbsent":false,"targetMustBeAbsent":true}}',
    '{"schemaVersion":1,"schemaVersion":1}',
    '{"schemaVersion":1.0}',
    '{"schemaVersion":1e0}',
    '{"schema\\u0056ersion":1}',
    '{"reason":"\\u0061"}',
    '{"number":1e309}',
  ])("rejects alternate interpretations before authority schema validation: %s", (text) => {
    expect(() => verifyAuthorityJson(Buffer.from(text))).toThrow();
  });
  it("rejects invalid UTF-8 and BOM instead of silently replacing bytes", () => {
    expect(() =>
      verifyAuthorityJson(Buffer.from([123, 34, 114, 34, 58, 34, 0xff, 34, 125])),
    ).toThrow();
    expect(() =>
      verifyAuthorityJson(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")])),
    ).toThrow();
  });
});
