import { describe, expect, it } from "vitest";
import { parsePositiveLimit } from "./limits.js";
describe("scanner resource bounds", () => {
  it.each(["nope", "NaN", "Infinity", "", "0", "-1", "1.5", "9007199254740992"])(
    "rejects invalid bound %s",
    (value) => {
      expect(() => parsePositiveLimit(value, "max-files")).toThrow();
      expect(() => parsePositiveLimit(value, "max-bytes")).toThrow();
    },
  );
  it("accepts finite positive integers and rejects timer overflow", () => {
    expect(parsePositiveLimit("10000", "max-files")).toBe(10000);
    expect(() => parsePositiveLimit("2147483648", "timeout", 2147483647)).toThrow();
  });
});
