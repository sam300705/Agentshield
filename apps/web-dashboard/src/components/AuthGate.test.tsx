// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authenticated: false }));
vi.mock("../lib/oidc", () => ({
  readOidcConfig: () => ({}),
  createFetchTokenClient: () => ({}),
  OidcSession: class {
    handleCallback() {
      state.authenticated = true;
      return Promise.resolve();
    }
    isAuthenticated() {
      return state.authenticated;
    }
    getAccessToken() {
      return Promise.resolve("memory-only-token");
    }
  },
}));
import { AuthGate } from "./AuthGate";
it("navigates from the OIDC callback to the dashboard while retaining the in-memory session", async () => {
  vi.stubEnv("VITE_APP_MODE", "live");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/callback?code=synthetic&state=synthetic");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <BrowserRouter>
          <AuthGate>
            <Routes>
              <Route path="/" element={<p>Protected dashboard</p>} />
            </Routes>
          </AuthGate>
        </BrowserRouter>,
      );
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(container.textContent).toContain("Protected dashboard");
    expect(state.authenticated).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
