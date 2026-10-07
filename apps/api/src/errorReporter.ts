export interface SafeErrorEvent {
  service: "agentshield-api" | "agentshield-worker";
  code: "HTTP_5XX" | "WORKER_STOPPED";
  correlationId?: string;
  traceId?: string;
}
let inFlight = 0;
/** Optional collector receives only this allowlisted envelope, never exceptions or request objects. */
export function reportError(event: SafeErrorEvent): void {
  const url = process.env.ERROR_REPORT_URL;
  if (!url || inFlight >= 4) return;
  inFlight += 1;
  const safe = {
    service: event.service,
    code: event.code,
    correlationId:
      event.correlationId && /^[A-Za-z0-9._:-]{1,128}$/.test(event.correlationId)
        ? event.correlationId
        : undefined,
    traceId: event.traceId && /^[a-f0-9]{32}$/.test(event.traceId) ? event.traceId : undefined,
  };
  void fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(2000),
    headers: {
      "Content-Type": "application/json",
      ...(process.env.ERROR_REPORT_TOKEN
        ? { Authorization: `Bearer ${process.env.ERROR_REPORT_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(safe),
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined)
    .finally(() => {
      inFlight -= 1;
    });
}
