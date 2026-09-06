import { expect, test } from "@playwright/test";

test.describe("AgentShield deterministic dashboard", () => {
  test("boots in explicitly labeled demo mode", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/AgentShield/i);
    await expect(page.getByText("DETERMINISTIC DEMO")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Security posture, with every decision explainable/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Open command palette" })).toBeVisible();
    await expect(page.getByRole("button", { name: "3 approvals" })).toBeVisible();
  });

  test("navigates findings and filters by severity", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Findings" }).click();

    await expect(
      page.getByRole("heading", { name: "Evidence, not alerts without context." }),
    ).toBeVisible();
    await expect(page.getByText(/\d+ findings/)).toBeVisible();
    await page.getByRole("button", { name: "CRITICAL" }).click();
    await expect(page.getByText("3 findings")).toBeVisible();
    await expect(page.getByText("Credential material accessed")).toBeVisible();
  });

  test("opens the command palette and runs a policy simulation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.getByRole("button", { name: "Policy time machine" }).last().click();

    await expect(
      page.getByRole("heading", { name: "Ask “what if?” without rewriting history." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Run deterministic simulation" }).click();
    await expect(page.getByText("production result")).toBeVisible();
    await expect(page.getByText("No original records are changed.")).toBeVisible();
  });

  test("replays the attack path and exposes the accessible graph fallback", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Replay attack scenario/ }).click();

    await expect(page.getByRole("heading", { name: "Session AS-1842" })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Attack path from agent task to blocked production change" }),
    ).toBeVisible();
    await page.getByText("Accessible graph relationship list").click();
    await expect(
      page.getByText(/Sensitive access and infrastructure mutation share correlation/),
    ).toBeVisible();
  });

  test("records the seeded approval decision and exports a receipt", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "3 approvals" }).click();
    await expect(
      page.getByRole("heading", { name: "Human judgment at the dangerous edge." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve with audit record" }).click();
    await expect(page.getByText("Approval recorded")).toBeVisible();

    await page.getByRole("button", { name: "Security receipts" }).click();
    await expect(
      page.getByRole("heading", { name: "A deterministic record of the gate." }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export JSON/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
  });

  test("supports keyboard navigation and a mobile viewport", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5173/");
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: /Security posture, with every decision explainable/i }),
    ).toBeVisible();
    await context.close();
  });
});
