import { describe, it, expect, vi, afterEach } from "vitest";
import { runCli } from "../src/index.js";
import * as scanner from "@agentshield/scanner";
import * as policyEngine from "@agentshield/policy-engine";

vi.mock("@agentshield/scanner", () => ({
  runScan: vi.fn(),
}));

vi.mock("@agentshield/policy-engine", () => ({
  evaluateFindings: vi.fn(),
}));

describe("CLI Implementation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with 0 when no blocking decisions are present", async () => {
    const runScanMock = scanner.runScan as ReturnType<typeof vi.fn>;
    runScanMock.mockResolvedValue({
      scanId: "test-scan",
      targetPath: "/mock/path",
      findings: [],
      dependencies: []
    });

    const evalMock = policyEngine.evaluateFindings as ReturnType<typeof vi.fn>;
    evalMock.mockReturnValue([]);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "agentshield", "scan", "."]);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits with 1 when a BLOCK decision is evaluated", async () => {
    const runScanMock = scanner.runScan as ReturnType<typeof vi.fn>;
    runScanMock.mockResolvedValue({
      scanId: "test-scan",
      targetPath: "/mock/path",
      findings: [{ id: "find-1", filePath: "vuln.ts", lineStart: 1, title: "Bad Secret" }],
      dependencies: []
    });

    const evalMock = policyEngine.evaluateFindings as ReturnType<typeof vi.fn>;
    evalMock.mockReturnValue([
      { findingId: "find-1", decision: "BLOCK" }
    ]);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "agentshield", "scan", "."]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[BLOCK] vuln.ts:1 - Bad Secret"));
  });

  it("exits with 2 on execution/configuration error", async () => {
    const runScanMock = scanner.runScan as ReturnType<typeof vi.fn>;
    runScanMock.mockRejectedValue(new Error("Scanner exploded"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCli(["node", "agentshield", "scan", "."]);

    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(consoleSpy).toHaveBeenCalledWith("Execution error:", "Scanner exploded");
  });

  it("outputs SARIF properly", async () => {
    const runScanMock = scanner.runScan as ReturnType<typeof vi.fn>;
    runScanMock.mockResolvedValue({
      scanId: "test-scan",
      targetPath: "/mock/path",
      findings: [{ id: "find-1", filePath: "vuln.ts", lineStart: 1, title: "Bad Secret", description: "Found bad secret" }],
      dependencies: []
    });

    const evalMock = policyEngine.evaluateFindings as ReturnType<typeof vi.fn>;
    evalMock.mockReturnValue([
      { findingId: "find-1", decision: "BLOCK" }
    ]);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "agentshield", "scan", ".", "--sarif"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleSpy).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sarifOutput = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(sarifOutput.version).toBe("2.1.0");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(sarifOutput.runs[0].results[0].properties.decision).toBe("BLOCK");
  });
});
