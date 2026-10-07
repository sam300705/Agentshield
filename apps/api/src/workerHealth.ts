import { readFile, rename, writeFile } from "node:fs/promises";
const path = process.env.WORKER_HEALTH_FILE ?? "/tmp/agentshield-worker-health.json";
export async function recordWorkerHealth(
  state: "starting" | "running" | "stopping" | "unavailable",
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({
      service: "agentshield-worker",
      state,
      heartbeatAt: Date.now(),
      pid: process.pid,
    }),
    { mode: 0o600 },
  );
  await rename(temporary, path);
}
export async function checkWorkerHealth(): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      state?: string;
      heartbeatAt?: number;
    };
    return (
      value.state === "running" &&
      typeof value.heartbeatAt === "number" &&
      Date.now() - value.heartbeatAt < 30_000
    );
  } catch {
    return false;
  }
}
