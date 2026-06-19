import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { DecisionBadge, SeverityBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { api, type ApprovalWithFinding } from "../lib/api";

export function Approvals() {
  const [approvals, setApprovals] = useState<ApprovalWithFinding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  async function loadApprovals() {
    const response = await api.listApprovals();
    setApprovals(response.data);
  }

  useEffect(() => {
    void loadApprovals()
      .catch(() => setError("Unable to load approvals. Confirm the API is running."))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleAction(approvalId: string, action: "approve" | "reject") {
    setPendingActionId(approvalId);
    setError(null);

    try {
      if (action === "approve") {
        await api.approve(approvalId, "Approved from AgentShield dashboard.");
      } else {
        await api.reject(approvalId, "Rejected from AgentShield dashboard.");
      }

      setApprovals((current) => current.filter((approval) => approval.id !== approvalId));
    } catch {
      setError("Unable to update approval. Confirm the API is running.");
    } finally {
      setPendingActionId(null);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading approvals" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Approvals</h2>
        <p className="mt-1 text-sm text-slate-600">
          Human review queue for policy decisions requiring approval.
        </p>
      </div>
      {error != null ? <ErrorState message={error} /> : null}
      {approvals.length === 0 ? <EmptyState message="No pending approvals." /> : null}
      <div className="grid gap-4">
        {approvals.map((approval) => (
          <article className="rounded border border-slate-200 bg-white p-5" key={approval.id}>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <div className="flex flex-wrap gap-2">
                  <SeverityBadge severity={approval.finding.severity} />
                  {approval.finding.policyDecision != null ? (
                    <DecisionBadge decision={approval.finding.policyDecision.decision} />
                  ) : null}
                </div>
                <h3 className="mt-3 text-base font-semibold text-slate-950">
                  {approval.finding.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {approval.finding.filePath}:{approval.finding.lineStart ?? "unknown"}
                </p>
                <Link
                  className="mt-3 inline-flex text-sm font-medium text-slate-950 hover:underline"
                  to={`/scans/${approval.finding.scanId}/findings/${approval.finding.id}`}
                >
                  Review finding
                </Link>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                  disabled={pendingActionId === approval.id}
                  onClick={() => void handleAction(approval.id, "approve")}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  disabled={pendingActionId === approval.id}
                  onClick={() => void handleAction(approval.id, "reject")}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
