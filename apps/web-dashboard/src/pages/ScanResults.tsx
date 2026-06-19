import type { Dependency } from "@agentshield/schemas";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { DecisionBadge, SeverityBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { api, type FindingWithRelations, type ScanDetail } from "../lib/api";

export function ScanResults() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [scan, setScan] = useState<ScanDetail | null>(null);
  const [findings, setFindings] = useState<FindingWithRelations[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [activeTab, setActiveTab] = useState<"findings" | "sbom">("findings");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scanId == null) {
      return;
    }

    void Promise.all([api.getScan(scanId), api.getFindings(scanId), api.getSbom(scanId)])
      .then(([scanResponse, findingsResponse, sbomResponse]) => {
        setScan(scanResponse.data);
        setFindings(findingsResponse.data);
        setDependencies(sbomResponse.data);
      })
      .catch(() => setError("Unable to load scan results. Confirm the API is running."))
      .finally(() => setIsLoading(false));
  }, [scanId]);

  const columns = useMemo<ColumnDef<FindingWithRelations>[]>(
    () => [
      {
        header: "Severity",
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
      },
      {
        header: "Category",
        accessorKey: "category",
      },
      {
        header: "Title",
        accessorKey: "title",
      },
      {
        header: "Decision",
        cell: ({ row }) =>
          row.original.policyDecision == null ? (
            <span className="text-slate-400">Pending</span>
          ) : (
            <DecisionBadge decision={row.original.policyDecision.decision} />
          ),
      },
    ],
    [],
  );
  const table = useReactTable({
    data: findings,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return <LoadingState label="Loading scan results" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <Link className="text-sm font-medium text-slate-500 hover:text-slate-950" to="/scans">
            Scans
          </Link>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            {scan?.repositoryName ?? "Scan Results"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {scan?.status ?? "UNKNOWN"} · {findings.length} findings · {dependencies.length} SBOM
            items
          </p>
        </div>
      </div>

      {error != null ? <ErrorState message={error} /> : null}

      <div className="flex gap-2">
        <button
          className={`rounded px-3 py-2 text-sm font-medium ${
            activeTab === "findings" ? "bg-slate-950 text-white" : "bg-white text-slate-700"
          }`}
          onClick={() => setActiveTab("findings")}
          type="button"
        >
          Findings
        </button>
        <button
          className={`rounded px-3 py-2 text-sm font-medium ${
            activeTab === "sbom" ? "bg-slate-950 text-white" : "bg-white text-slate-700"
          }`}
          onClick={() => setActiveTab("sbom")}
          type="button"
        >
          SBOM Inventory
        </button>
      </div>

      {activeTab === "findings" ? (
        findings.length === 0 ? (
          <EmptyState message="No findings were returned for this scan." />
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th className="px-4 py-3" key={header.id}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-200">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    className="cursor-pointer hover:bg-slate-50"
                    key={row.id}
                    onClick={() => navigate(`/scans/${scanId}/findings/${row.original.id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td className="px-4 py-3 text-slate-700" key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Manifest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {dependencies.map((dependency) => (
                <tr key={dependency.id}>
                  <td className="px-4 py-3 font-medium text-slate-950">{dependency.packageName}</td>
                  <td className="px-4 py-3 text-slate-600">{dependency.version}</td>
                  <td className="px-4 py-3 text-slate-600">{dependency.scope}</td>
                  <td className="px-4 py-3 text-slate-600">{dependency.manifestPath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
