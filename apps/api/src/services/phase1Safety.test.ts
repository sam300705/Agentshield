import { ConfiguredScanJobExecutor } from "./scanJobExecutor.js";
import { describe, expect, it, vi } from "vitest";
import { assertSafeSeedTarget } from "./seedSafety.js";
import {
  assertScanLease,
  partitionAdvisoryResults,
  receiptSigningSettings,
  runConfiguredScan,
  type ScanRunOptions,
} from "./scanService.js";

describe("Phase 1 configuration safety", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "allows the explicit local seed target %s",
    (host) => {
      expect(() =>
        assertSafeSeedTarget(undefined, `postgresql://user:pass@${host}/agentshield`),
      ).not.toThrow();
    },
  );
  it.each([
    "postgresql://u:p@localhost.example.com/agentshield",
    "postgresql://u:p@remote.invalid/agentshield?host=localhost",
    "postgresql://u:p@localhost/production",
    "postgresql://u:p@localhost/agentshield?host=remote.invalid",
    "postgresql://u:p@localhost/agentshield?schema=production",
    "invalid",
    "https://localhost/agentshield",
  ])("rejects unsafe seed target %s", (url) => {
    expect(() => assertSafeSeedTarget(undefined, url)).toThrow();
  });
  it("rejects production even on loopback", () => {
    expect(() =>
      assertSafeSeedTarget("production", "postgresql://localhost/agentshield"),
    ).toThrow();
  });
  it("treats blank signing variables as unconfigured and rejects partial configuration", () => {
    expect(
      receiptSigningSettings({ RECEIPT_SIGNING_PRIVATE_KEY: "  ", RECEIPT_SIGNING_KEY_ID: "" }),
    ).toEqual({ privateKey: undefined, keyId: undefined });
    expect(() => receiptSigningSettings({ RECEIPT_SIGNING_KEY_ID: "key" })).toThrow();
    expect(() =>
      receiptSigningSettings({ RECEIPT_SIGNING_PRIVATE_KEY: "key", RECEIPT_SIGNING_KEY_ID: " " }),
    ).toThrow();
  });
  it("rejects unsupported policy lineage before any persistence", async () => {
    await expect(
      runConfiguredScan({ policyBundleVersion: "untrusted" } as ScanRunOptions),
    ).rejects.toThrow("Unsupported policy bundle");
  });
});

it("keeps unresolved inventory separate from confirmed advisories", () => {
  const result = partitionAdvisoryResults([
    {
      packageName: "test",
      version: "^1",
      packageManager: "NPM",
      advisories: [
        {
          advisoryId: "UNRESOLVED_VERSION",
          summary: null,
          references: [],
          aliases: [],
          severity: "UNKNOWN",
          fixedVersions: [],
          match: "UNCERTAIN",
          matchReason: "Non-exact version",
        },
      ],
    },
  ]);
  expect(result.confirmed[0]?.advisories).toEqual([]);
  expect(result.diagnostics).toEqual([
    { packageName: "test", version: "^1", match: "UNCERTAIN", matchReason: "Non-exact version" },
  ]);
});

it("rejects a forged local-demo policy before bypassing configured scan validation", async () => {
  await expect(
    new ConfiguredScanJobExecutor().execute({
      scanId: "scan",
      signal: new AbortController().signal,
      payload: {
        organizationId: "org",
        repositoryId: "local-demo",
        provider: "LOCAL",
        repositoryName: "demo",
        ref: "main",
        policyBundleVersion: "forged",
        trigger: "MANUAL",
        requester: "user",
        correlationId: "corr",
        options: {},
      },
    }),
  ).rejects.toThrow("Unsupported policy bundle");
});

it("refuses a superseded or expired scan lease before any persistence", async () => {
  const lease = { owner: "worker-original", attempt: 2 };
  const query = vi.fn().mockResolvedValue([]);
  const tx = { $queryRaw: query };
  await expect(assertScanLease(tx as never, "scan-one", lease)).rejects.toThrow(
    "WORKER_LEASE_LOST",
  );
  expect(query).toHaveBeenCalledTimes(1);
  const sql = (query.mock.calls as unknown as unknown[][])[0]?.[0] as { values: unknown[] };
  expect(sql.values).toEqual(["scan-one", "worker-original", 2]);
  query.mockResolvedValue([{ id: "job-original" }]);
  await expect(assertScanLease(tx as never, "scan-one", lease)).resolves.toBeUndefined();
});
