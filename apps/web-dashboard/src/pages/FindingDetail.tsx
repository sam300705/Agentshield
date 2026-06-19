import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { DecisionBadge, SeverityBadge } from "../components/StatusBadge";
import { ErrorState, LoadingState } from "../components/State";
import { api, type FindingWithRelations } from "../lib/api";

function readPatchText(finding: FindingWithRelations, key: string): string | null {
  const patch = finding.remediation?.patch;

  if (typeof patch !== "object" || patch == null || Array.isArray(patch)) {
    return null;
  }

  const value = patch[key];

  return typeof value === "string" ? value : null;
}

export function FindingDetail() {
  const { scanId, findingId } = useParams();
  const [finding, setFinding] = useState<FindingWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scanId == null || findingId == null) {
      return;
    }

    void api
      .getFindings(scanId, 100)
      .then((response) => {
        const selectedFinding = response.data.find((item) => item.id === findingId) ?? null;
        setFinding(selectedFinding);
      })
      .catch(() => setError("Unable to load finding details. Confirm the API is running."))
      .finally(() => setIsLoading(false));
  }, [findingId, scanId]);

  const evidenceText = useMemo(
    () => (finding == null ? "" : JSON.stringify(finding.evidence, null, 2)),
    [finding],
  );

  if (isLoading) {
    return <LoadingState label="Loading finding" />;
  }

  if (finding == null) {
    return <ErrorState message={error ?? "Finding not found."} />;
  }

  const explanation = readPatchText(finding, "explanation");
  const prComment = readPatchText(finding, "prComment");
  const fixSuggestion = readPatchText(finding, "fixSuggestion");

  return (
    <div className="space-y-5">
      <div>
        <Link
          className="text-sm font-medium text-slate-500 hover:text-slate-950"
          to={`/scans/${scanId}`}
        >
          Scan results
        </Link>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
          {finding.title}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <SeverityBadge severity={finding.severity} />
          {finding.policyDecision != null ? (
            <DecisionBadge decision={finding.policyDecision.decision} />
          ) : null}
        </div>
      </div>

      <section className="rounded border border-slate-200 bg-white p-5">
        <h3 className="text-base font-semibold text-slate-950">Evidence</h3>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <dt className="font-medium text-slate-500">File</dt>
            <dd className="mt-1 text-slate-950">{finding.filePath}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Line</dt>
            <dd className="mt-1 text-slate-950">{finding.lineStart ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Category</dt>
            <dd className="mt-1 text-slate-950">{finding.category}</dd>
          </div>
        </dl>
        <pre className="mt-4 max-h-80 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-100">
          {evidenceText}
        </pre>
      </section>

      {finding.remediation != null ? (
        <section className="rounded border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-950">Remediation</h3>
          <div className="mt-4 grid gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">Explanation</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{explanation}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">PR Comment</p>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-4 text-sm text-slate-700">
                {prComment}
              </pre>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Fix Suggestion</p>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-950 p-4 text-sm text-slate-100">
                {fixSuggestion}
              </pre>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
