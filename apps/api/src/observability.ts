import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const counters = new Map<string, { count: number; seconds: number }>();
export function renderHttpMetrics(): string {
  return [...counters]
    .flatMap(([key, value]) => {
      const [method, status] = key.split(":");
      const labels = `method="${method}",status="${status}"`;
      return [
        `agentshield_http_requests_total{${labels}} ${value.count}`,
        `agentshield_http_duration_seconds_sum{${labels}} ${value.seconds}`,
      ];
    })
    .join("\n");
}
export const observeRequest: RequestHandler = (request, response, next) => {
  const start = performance.now();
  const incoming = request.header("traceparent");
  const traceId =
    incoming != null &&
    /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/.test(incoming) &&
    !incoming.includes("-00000000000000000000000000000000-")
      ? incoming.split("-")[1]
      : randomUUID().replaceAll("-", "");
  response.locals.traceId = traceId;
  response.on("finish", () => {
    const method = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"].includes(
      request.method,
    )
      ? request.method
      : "OTHER";
    const status = String(Math.floor(response.statusCode / 100)) + "xx";
    const seconds = (performance.now() - start) / 1000;
    const key = `${method}:${status}`;
    const current = counters.get(key) ?? { count: 0, seconds: 0 };
    counters.set(key, { count: current.count + 1, seconds: current.seconds + seconds });
    // Never serialize URL, body, query, headers, actor claims or exception objects.
    console.warn(
      JSON.stringify({
        level: response.statusCode >= 500 ? "error" : "info",
        service: "agentshield-api",
        event: "http_request",
        method,
        status: response.statusCode,
        durationMs: Math.round(seconds * 1000),
        correlationId:
          typeof response.locals.correlationId === "string"
            ? response.locals.correlationId
            : "unknown",
        traceId,
      }),
    );
  });
  next();
};
