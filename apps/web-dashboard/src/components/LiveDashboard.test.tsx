// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LiveDashboard } from "./LiveDashboard";
import { Approvals } from "../pages/Approvals";
const reviewAgent = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {} })));
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
    listScans: () =>
      Promise.resolve({
        data: [
          {
            id: "scan-one",
            repositoryName: "synthetic/repo",
            branch: "main",
            status: "COMPLETED",
            _count: { findings: 2, dependencies: 1 },
          },
        ],
      }),
    listApprovals: () =>
      Promise.resolve({
        agentApprovals: {
          total: 1,
          page: 1,
          limit: 25,
          data: [
            {
              id: "agent-approval",
              actionType: "RUN_COMMAND",
              sessionId: "session",
              requestedBy: "agent",
              actionDigest: "a".repeat(64),
              resource: "workspace",
              evidence: { command: "echo reviewed" },
              evidenceAvailable: true,
            },
          ],
        },
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
    reviewAgentApproval: reviewAgent,
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
    expect(container.querySelector('a[href="/scans/scan-one"]')?.textContent).toContain(
      "View scan",
    );
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
    const agentButton = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Approve agent action",
    ) as HTMLButtonElement;
    expect(agentButton.disabled).toBe(true);
    const digest = container.querySelector<HTMLInputElement>("#digest-agent-approval")!;
    const reason = container.querySelector<HTMLInputElement>("#reason-agent-approval")!;
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
      descriptor.set!.call(digest, "a".repeat(64));
      digest.dispatchEvent(new Event("input", { bubbles: true }));
      descriptor.set!.call(reason, "Independent action review");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(agentButton.disabled).toBe(false);
    await act(async () => {
      agentButton.click();
      await Promise.resolve();
    });
    expect(reviewAgent).toHaveBeenCalledWith(
      "agent-approval",
      "approve",
      "Independent action review",
      "a".repeat(64),
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    vi.unstubAllGlobals();
    container.remove();
  }
});
