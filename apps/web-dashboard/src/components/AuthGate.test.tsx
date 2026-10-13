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
    logout() {
      state.authenticated = false;
      return undefined;
    }
    getAccessToken() {
      return Promise.resolve("memory-only-token");
    }
  },
}));
import { notifyApiAuthFailure } from "../lib/auth";
import { AuthGate } from "./AuthGate";
it("navigates from the OIDC callback to the dashboard while retaining the in-memory session", async () => {
  vi.stubEnv("VITE_APP_MODE", "live");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
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

it("shows live configuration as unavailable when its API origin is missing", async () => {
  vi.stubEnv("VITE_APP_MODE", "live");
  vi.stubEnv("VITE_API_BASE_URL", "");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <BrowserRouter>
          <AuthGate>
            <p>Protected dashboard</p>
          </AuthGate>
        </BrowserRouter>,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Live mode is not configured");
    expect(container.textContent).not.toContain("Protected dashboard");
    expect(container.querySelector("button")).toBeNull();
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

it("retains authenticated navigation and sign-out after a capability 403", async () => {
  state.authenticated = true;
  vi.stubEnv("VITE_APP_MODE", "live");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <BrowserRouter>
          <AuthGate>
            <p>Permitted scan views</p>
          </AuthGate>
        </BrowserRouter>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      notifyApiAuthFailure(403);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Permitted scan views");
    expect(container.textContent).toContain("Organization overview");
    const logout = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Sign out",
    );
    expect(logout).toBeDefined();
    await act(async () => {
      logout?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Sign in to AgentShield");
    expect(state.authenticated).toBe(false);
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
