import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorState, LoadingState } from "../components/State";
import { api, type DashboardSummary } from "../lib/api";

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getDashboardSummary()
      .then(setSummary)
      .catch(() =>
        setError("Unable to load dashboard data. Confirm the API is running on port 3001."),
      )
      .finally(() => setIsLoading(false));
  }, []);

  async function handleRunDemoScan() {
    setIsRunning(true);
    setError(null);

    try {
      const result = await api.runDemoScan();
      navigate(`/scans/${result.scanId}`);
    } catch {
      setError("Demo scan failed. Confirm PostgreSQL and the API are running.");
    } finally {
      setIsRunning(false);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading dashboard" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-600">
            Platform risk posture across AI-agent software delivery scans.
          </p>
        </div>
        <button
          className="rounded bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={isRunning}
          onClick={() => void handleRunDemoScan()}
          type="button"
        >
          {isRunning ? "Running Scan..." : "Run Demo Scan"}
        </button>
      </div>

      {error != null ? <ErrorState message={error} /> : null}

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Total Scans" value={summary?.totalScans ?? 0} />
        <SummaryCard label="Total Findings" value={summary?.totalFindings ?? 0} />
        <SummaryCard label="Pending Approvals" value={summary?.pendingApprovalsCount ?? 0} />
        <SummaryCard
          label="Platform Risk Score"
          value={summary?.latestScan?.platformRiskScore ?? "B"}
        />
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Latest Scan Metrics</h3>
        </div>
        <div className="grid gap-px bg-slate-200 md:grid-cols-4">
          <div className="bg-white p-5">
            <p className="text-sm text-slate-500">Critical</p>
            <p className="mt-2 text-2xl font-semibold text-red-700">
              {summary?.latestScan?.severityCounts.critical ?? 0}
            </p>
          </div>
          <div className="bg-white p-5">
            <p className="text-sm text-slate-500">High</p>
            <p className="mt-2 text-2xl font-semibold text-orange-700">
              {summary?.latestScan?.severityCounts.high ?? 0}
            </p>
          </div>
          <div className="bg-white p-5">
            <p className="text-sm text-slate-500">Blocked</p>
            <p className="mt-2 text-2xl font-semibold text-red-700">
              {summary?.latestScan?.decisionCounts.block ?? 0}
            </p>
          </div>
          <div className="bg-white p-5">
            <p className="text-sm text-slate-500">Requires Approval</p>
            <p className="mt-2 text-2xl font-semibold text-orange-700">
              {summary?.latestScan?.decisionCounts.requireApproval ?? 0}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
