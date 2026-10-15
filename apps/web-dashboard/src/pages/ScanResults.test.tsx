// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ScanResults } from "./ScanResults";
const metadata = vi.hoisted((): { coverage: unknown } => ({ coverage: undefined }));
const getSbom = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({
  api: {
    getScan: () =>
      Promise.resolve({
        data: {
          metadata,
          repositoryName: "synthetic/repo",
          status: "COMPLETED",
          _count: { findings: 0, dependencies: 101 },
        },
      }),
    getFindings: () => Promise.resolve({ data: [], total: 0 }),
    getSbom,
  },
}));
it("renders API SBOM columns and preserves server pagination and empty state", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  getSbom.mockResolvedValueOnce({
    data: [
      {
        id: "dep",
        packageName: "alpha",
        version: "1.0.0",
        scope: "PRODUCTION",
        manifestPath: "package.json",
      },
    ],
    total: 101,
  });
  getSbom.mockResolvedValueOnce({ data: [], total: 101 });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/scans/scan"]}>
          <Routes>
            <Route path="/scans/:scanId" element={<ScanResults />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Coverage unavailable for this historical scan");
    const sbom = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "SBOM Inventory",
    )!;
    await act(async () => {
      sbom.click();
      await Promise.resolve();
    });
    expect(Array.from(host.querySelectorAll("th")).map((cell) => cell.textContent)).toEqual([
      "Package",
      "Version",
      "Scope",
      "Manifest",
    ]);
    expect(host.textContent).toContain("alpha");
    const next = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Next",
    )!;
    await act(async () => {
      next.click();
      await Promise.resolve();
    });
    expect(getSbom).toHaveBeenLastCalledWith("scan", 100, 2);
    expect(host.textContent).toContain("No SBOM items");
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
  }
});

it("shows observed coverage and limitations without claiming hidden directory file counts", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  metadata.coverage = {
    status: "PARTIAL",
    scope:
      "Supported static checks within the observed scope; not proof of safety or complete event capture.",
    enumeratedFiles: 2,
    inspectedFiles: 1,
    unsupportedFiles: 1,
    excludedEntries: 1,
  };
  getSbom.mockResolvedValue({ data: [], total: 0 });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/scans/scan"]}>
          <Routes>
            <Route path="/scans/:scanId" element={<ScanResults />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(host.textContent).toContain(
      "PARTIAL: 2 files enumerated; 1 inspected; 1 unsupported; 1 entries excluded.",
    );
    expect(host.textContent).toContain("not proof of safety");
    expect(host.textContent).toContain("Files beneath them were not enumerated");
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    metadata.coverage = undefined;
  }
});
