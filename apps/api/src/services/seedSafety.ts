export function assertSafeSeedTarget(nodeEnv: string | undefined, databaseUrl: string): void {
  if (nodeEnv === "production") {
    throw new Error("Refusing to seed when NODE_ENV=production.");
  }
  const target = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/agentshield" ||
    ["host", "hostaddr", "dbname", "database", "options"].some((key) =>
      target.searchParams.has(key),
    ) ||
    (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")
  ) {
    throw new Error("Refusing to seed anything except the isolated local agentshield database.");
  }
}
