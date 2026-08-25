import { useEffect, useMemo, useState } from "react";

import { configureApiAuth } from "../lib/auth";
import { createFetchTokenClient, OidcSession, readOidcConfig, type OidcConfig } from "../lib/oidc";

interface AuthGateProps {
  children: React.ReactNode;
}

type GateState =
  | "initializing"
  | "unauthenticated"
  | "authenticated"
  | "unavailable"
  | "unauthorized"
  | "forbidden"
  | "error";

function envConfig(): OidcConfig | null {
  return readOidcConfig(import.meta.env);
}

export function AuthGate({ children }: AuthGateProps) {
  const liveMode = import.meta.env.VITE_APP_MODE === "live";
  const config = useMemo(envConfig, []);
  const session = useMemo(
    () => (config == null ? null : new OidcSession(config, createFetchTokenClient(config))),
    [config],
  );
  const [state, setState] = useState<GateState>("initializing");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (session == null) {
      configureApiAuth(null);
      setState("unavailable");
      return;
    }
    configureApiAuth({
      getAccessToken: () => session.getAccessToken(),
      onUnauthorized: () => setState("unauthorized"),
      onForbidden: () => setState("forbidden"),
    });
    const callback = new URL(window.location.href);
    if (callback.searchParams.has("code") || callback.searchParams.has("error")) {
      session
        .handleCallback(callback.toString())
        .then(() => {
          window.history.replaceState(
            {},
            document.title,
            `${window.location.pathname}${window.location.hash}`,
          );
          setState("authenticated");
        })
        .catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : "OIDC callback failed.");
          setState("error");
        });
      return () => configureApiAuth(null);
    }
    setState(session.isAuthenticated() ? "authenticated" : "unauthenticated");
    return () => configureApiAuth(null);
  }, [session]);

  const login = async () => {
    if (session == null) return;
    try {
      window.location.assign(await session.beginLogin());
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Unable to start OIDC login.");
      setState("error");
    }
  };

  const logout = () => {
    if (session == null) return;
    const logoutUrl = session.logout();
    if (logoutUrl != null) window.location.assign(logoutUrl);
    else setState("unauthenticated");
  };

  if (!liveMode) return <>{children}</>;

  if (state === "authenticated") {
    return (
      <>
        <div className="live-session-bar" role="status">
          <span>Authenticated live mode</span>
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
        {children}
      </>
    );
  }

  const title =
    state === "unavailable"
      ? "Live mode is not configured"
      : state === "unauthorized"
        ? "Your session expired"
        : state === "forbidden"
          ? "Access denied"
          : state === "error"
            ? "Sign-in could not be completed"
            : "Sign in to AgentShield";
  const detail =
    state === "unavailable"
      ? "A production OIDC provider must be configured before live customer data can be shown. The demo mode remains available when VITE_APP_MODE is not live."
      : state === "unauthorized"
        ? "The API rejected the session. Sign in again to request a fresh authorization-code flow."
        : state === "forbidden"
          ? "Your identity is authenticated but does not have permission for this organization or capability."
          : (message ??
            "AgentShield never stores access tokens in localStorage or sessionStorage.");

  return (
    <main className="auth-gate" aria-labelledby="auth-title">
      <section className="auth-card">
        <p className="eyebrow">AgentShield · protected console</p>
        <h1 id="auth-title">{title}</h1>
        <p>{detail}</p>
        {state !== "unavailable" && state !== "forbidden" && (
          <button type="button" className="primary-action" onClick={() => void login()}>
            Sign in with identity provider
          </button>
        )}
        {state === "unavailable" && <code>Missing VITE_OIDC_* configuration</code>}
      </section>
    </main>
  );
}
