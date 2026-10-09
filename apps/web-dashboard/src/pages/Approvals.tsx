import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { DecisionBadge, SeverityBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { ApiError, api, type ApprovalWithFinding, type AgentApprovalReviewItem } from "../lib/api";

export function Approvals() {
  const requestGeneration = useRef(0);
  const [approvals, setApprovals] = useState<ApprovalWithFinding[]>([]);
  const [agents, setAgents] = useState<AgentApprovalReviewItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [agentQueueAvailable, setAgentQueueAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const response = await api.listApprovals(25, page);
    if (generation !== requestGeneration.current) return;
    setApprovals(response.data);
    setAgents(response.agentApprovals?.data ?? []);
    setAgentQueueAvailable(response.agentApprovals != null);
    setTotalPages(
      Math.max(
        1,
        Math.ceil(Math.max(response.total ?? 0, response.agentApprovals?.total ?? 0) / 25),
      ),
    );
  }, [page]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    void loadApprovals()
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof ApiError && error.status === 403
              ? "Access denied: your role cannot review approvals. You can return to the organization overview."
              : "Unable to load approvals.",
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      requestGeneration.current += 1;
    };
  }, [loadApprovals]);

  async function handleAgentAction(
    approval: AgentApprovalReviewItem,
    action: "approve" | "reject",
    reason: string,
  ) {
    setPendingActionId(approval.id);
    setError(null);
    try {
      await api.reviewAgentApproval(approval.id, action, reason, approval.actionDigest);
      setAgents((current) => current.filter((item) => item.id !== approval.id));
    } catch (error: unknown) {
      setError(
        error instanceof ApiError && error.status === 403
          ? "Review denied: an independent authorized reviewer is required."
          : "Unable to review this action; it may no longer be pending. Refresh the queue.",
      );
    } finally {
      setPendingActionId(null);
    }
  }

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
      <Link to="/">Return to organization overview</Link>
      {error != null ? (
        <div role="alert">
          <ErrorState message={error} />
        </div>
      ) : null}
      {approvals.length === 0 && agents.length === 0 && error == null ? (
        <EmptyState message="No pending approvals." />
      ) : null}
      <section aria-label="Agent action approvals">
        <h3>Pending agent actions</h3>
        {!agentQueueAvailable && error == null ? <p>Agent approval queue unavailable.</p> : null}
        {agents.map((approval) => (
          <AgentApprovalCard
            key={approval.id}
            approval={approval}
            busy={pendingActionId != null}
            onReview={handleAgentAction}
          />
        ))}
      </section>
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
      <nav aria-label="Approval queue pages">
        <button
          type="button"
          disabled={page <= 1 || pendingActionId != null}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous page
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages || pendingActionId != null}
          onClick={() => setPage((current) => current + 1)}
        >
          Next page
        </button>
        <button
          type="button"
          onClick={() => void loadApprovals().catch(() => setError("Unable to refresh approvals."))}
        >
          Refresh queue
        </button>
      </nav>
    </div>
  );
}

function AgentApprovalCard({
  approval,
  busy,
  onReview,
}: {
  approval: AgentApprovalReviewItem;
  busy: boolean;
  onReview: (
    approval: AgentApprovalReviewItem,
    action: "approve" | "reject",
    reason: string,
  ) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const confirmed = confirmation === approval.actionDigest && reason.trim().length > 0;
  return (
    <article className="rounded border border-slate-200 p-5">
      <h4>{approval.actionType}</h4>
      <p>
        Session: {approval.sessionId} · Requester: {approval.requestedBy}
      </p>
      <p>Resource: {approval.resource ?? "Unavailable"}</p>
      <p>
        Exact action digest: <code className="break-all">{approval.actionDigest}</code>
      </p>
      {approval.evidenceAvailable ? (
        <pre className="overflow-x-auto" aria-label="Sanitized action evidence">
          {JSON.stringify(approval.evidence, null, 2)}
        </pre>
      ) : (
        <p>Evidence unavailable. Request a fresh action before approval.</p>
      )}
      <label htmlFor={`digest-${approval.id}`}>
        Enter the exact action digest to confirm review
      </label>
      <input
        id={`digest-${approval.id}`}
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <label htmlFor={`reason-${approval.id}`}>Review reason</label>
      <input
        id={`reason-${approval.id}`}
        value={reason}
        maxLength={1000}
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="button"
        disabled={busy || !confirmed || !approval.evidenceAvailable}
        onClick={() => void onReview(approval, "approve", reason.trim())}
      >
        Approve agent action
      </button>
      <button
        type="button"
        disabled={busy || !confirmed}
        onClick={() => void onReview(approval, "reject", reason.trim())}
      >
        Reject agent action
      </button>
      <p>Independent reviewer access is enforced by the API.</p>
    </article>
  );
}
