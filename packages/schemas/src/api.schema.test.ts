import { describe, expect, it } from "vitest";

import {
  apiErrorEnvelopeSchema,
  paginatedResponseSchema,
  paginationQuerySchema,
} from "./api.schema.js";

describe("versioned API contracts", () => {
  it("normalizes bounded pagination query defaults", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 25 });
    expect(paginationQuerySchema.parse({ page: "2", limit: "100" })).toEqual({
      page: 2,
      limit: 100,
    });
    expect(() => paginationQuerySchema.parse({ limit: "101" })).toThrow();
  });

  it("accepts a standardized error envelope and rejects missing correlation IDs", () => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: "SCAN_NOT_FOUND",
          message: "Scan was not found.",
          correlationId: "corr-123",
        },
      }).error.code,
    ).toBe("SCAN_NOT_FOUND");
    expect(() =>
      apiErrorEnvelopeSchema.parse({
        error: { code: "BAD_REQUEST", message: "Invalid request." },
      }),
    ).toThrow();
  });

  it("accepts paginated data without prescribing resource-specific fields", () => {
    expect(
      paginatedResponseSchema.parse({
        page: 1,
        limit: 25,
        total: 1,
        data: [{ id: "scan-1" }],
      }),
    ).toMatchObject({ page: 1, limit: 25, total: 1 });
  });
});
