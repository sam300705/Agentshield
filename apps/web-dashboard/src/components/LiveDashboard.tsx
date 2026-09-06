import { useCallback, useEffect, useState } from "react";

import { ApiError, api, type DashboardSummary, type ScanListItem } from "../lib/api";

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const status = error instanceof ApiError ? error.status : null;
  const title =
    status === 401 ? "Session expired" : status === 403 ? "Access denied" : "Live data unavailable";
  const detail =
    status === 401
      ? "Sign in again to continue."
      : status === 403
        ? "Your identity does not have access to this organization or capability."
        : "The AgentShield API could not be reached. No fixture data is being shown.";
  return (
    <section className="auth-card" role="alert">
      <h2>{title}</h2>
      <p>{detail}</p>
      <button type="button" className="secondary-action" onClick={retry}>
        Retry
      </button>
    </section>
  );
}

export function LiveDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scans, setScans] = useState<ScanListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, scansResponse] = await Promise.all([
        api.getDashboardSummary(),
        api.listScans(10, 1),
      ]);
      setSummary(summaryResponse);
      setScans(scansResponse.data);
    } catch (nextError: unknown) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="live-console" aria-busy="true">
        <section className="auth-card">
          <p>Loading authenticated organization data…</p>
        </section>
      </main>
    );
  }

  if (error != null) {
    return (
      <main className="live-console">
        <ErrorState error={error} retry={() => void load()} />
      </main>
    );
  }

  return (
    <main className="live-console">
      <header className="live-console-header">
        <div>
          <p className="eyebrow">Authenticated organization console</p>
          <h1>Security posture from the AgentShield API</h1>
          <p>
            No fixture data is used in this mode. Organization scope comes from the validated API
            identity.
          </p>
        </div>
        <button type="button" className="secondary-action" onClick={() => void load()}>
          Refresh
        </button>
      </header>
      <section className="live-stats" aria-label="Dashboard summary">
        <article>
          <span>Total scans</span>
          <strong>{summary?.totalScans ?? 0}</strong>
        </article>
        <article>
          <span>Total findings</span>
          <strong>{summary?.totalFindings ?? 0}</strong>
        </article>
        <article>
          <span>Pending approvals</span>
          <strong>{summary?.pendingApprovalsCount ?? 0}</strong>
        </article>
        <article>
          <span>Latest risk</span>
          <strong>{summary?.latestScan?.platformRiskScore ?? "—"}</strong>
        </article>
      </section>
      <section className="panel live-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Scan history</p>
            <h2>Recent organization scans</h2>
          </div>
          <span>{scans.length} loaded</span>
        </div>
        {scans.length === 0 ? (
          <p className="empty-state">No scans are available for this organization yet.</p>
        ) : (
          <div className="live-scan-list">
            {scans.map((scan) => (
              <article key={scan.id}>
                <div>
                  <b>{scan.repositoryName}</b>
                  <span>{scan.branch}</span>
                </div>
                <span>{scan.status}</span>
                <span>{scan._count.findings} findings</span>
                <span>{scan._count.dependencies} dependencies</span>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="auth-card live-unavailable">
        <h2>Additional workflows require activation</h2>
        <p>
          Repository onboarding, scan creation, vulnerability enrichment, signed receipt export, and
          organization selection are not exposed as fake controls. They become available only after
          the corresponding GitHub App, persistence, and deployment configuration is verified.
        </p>
      </section>
    </main>
  );
}
