import type { AuditEvent } from "@agentshield/schemas";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { api } from "../lib/api";

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listAuditEvents()
      .then((response) => setEvents(response.data))
      .catch(() => setError("Unable to load audit events. Confirm the API is running."))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <LoadingState label="Loading audit trail" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Audit Trail</h2>
        <p className="mt-1 text-sm text-slate-600">
          Chronological record of scan and approval activity.
        </p>
      </div>
      {error != null ? <ErrorState message={error} /> : null}
      {events.length === 0 ? <EmptyState message="No audit events have been recorded." /> : null}
      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        {events.map((event) => (
          <div className="border-b border-slate-200 p-4 last:border-b-0" key={event.id}>
            <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold text-slate-950">{event.action}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {event.entityType} · {event.entityId}
                </p>
              </div>
              <div className="text-sm text-slate-500">
                {event.actor} · {new Date(event.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
