export function resolveApiBaseUrl(env: Record<string, unknown>): string {
  const value = typeof env.VITE_API_BASE_URL === "string" ? env.VITE_API_BASE_URL.trim() : "";
  if (env.VITE_APP_MODE !== "live") return value.replace(/\/$/, "") || "http://localhost:3001";
  if (!value) throw new Error("Live mode requires VITE_API_BASE_URL.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Live mode requires an HTTPS API origin without credentials, path, query or fragment.",
    );
  }
  return url.origin;
}
