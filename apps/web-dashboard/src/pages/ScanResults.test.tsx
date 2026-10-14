// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ScanResults } from "./ScanResults";
const getSbom = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({
  api: {
    getScan: () =>
      Promise.resolve({
        data: {
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
