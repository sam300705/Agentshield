import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { api, type ScanListItem } from "../lib/api";

export function Scans() {
  const [scans, setScans] = useState<ScanListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listScans()
      .then((response) => setScans(response.data))
      .catch(() => setError("Unable to load scans. Confirm the API is running."))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <LoadingState label="Loading scans" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Scans</h2>
        <p className="mt-1 text-sm text-slate-600">Recent AgentShield scan executions.</p>
      </div>
      {error != null ? <ErrorState message={error} /> : null}
      {scans.length === 0 ? <EmptyState message="No scans have been recorded yet." /> : null}
      {scans.length > 0 ? (
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Repository</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Findings</th>
                <th className="px-4 py-3">Dependencies</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {scans.map((scan) => (
                <tr className="hover:bg-slate-50" key={scan.id}>
                  <td className="px-4 py-3 font-medium text-slate-950">
                    <Link className="hover:underline" to={`/scans/${scan.id}`}>
                      {scan.repositoryName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{scan.status}</td>
                  <td className="px-4 py-3 text-slate-600">{scan._count.findings}</td>
                  <td className="px-4 py-3 text-slate-600">{scan._count.dependencies}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(scan.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
