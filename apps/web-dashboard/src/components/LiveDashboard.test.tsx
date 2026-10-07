// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LiveDashboard } from "./LiveDashboard";
import { Approvals } from "../pages/Approvals";
const approve = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {} })));
vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getDashboardSummary: () =>
      Promise.resolve({
        totalScans: 1,
        totalFindings: 1,
        pendingApprovalsCount: 1,
        platformRiskScore: "F",
        latestScan: null,
      }),
    listScans: () => Promise.resolve({ data: [] }),
    listApprovals: () =>
      Promise.resolve({
        data: [
          {
            id: "approval",
            finding: {
              id: "finding",
              scanId: "scan",
              severity: "HIGH",
              policyDecision: null,
              title: "Review this risk",
              filePath: "Dockerfile",
              lineStart: 1,
            },
          },
        ],
      }),
    approve,
  },
}));
it("opens live pending approvals and performs an authenticated review through the existing API", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<LiveDashboard />} />
            <Route path="/approvals" element={<Approvals />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    const link = container.querySelector<HTMLAnchorElement>('a[href="/approvals"]');
    expect(link?.textContent).toBe("Review pending approvals");
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Review this risk");
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Approve",
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(approve).toHaveBeenCalledWith("approval", "Approved from AgentShield dashboard.");
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    vi.unstubAllGlobals();
    container.remove();
  }
});
