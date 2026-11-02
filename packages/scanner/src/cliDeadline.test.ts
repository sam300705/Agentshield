import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("ends the CLI's complete OSV operation when the response body hangs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentshield-deadline-"));
  let requested = false;
  const server = createServer((_request, response) => {
    requested = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"results":[');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("Missing test address");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { alpha: "1.0.0" } }),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("src/cli.ts"),
      "--path",
      root,
      "--format",
      "json",
      "--osv",
      "--timeout",
      "1000",
    ],
    {
      env: {
        ...process.env,
        OSV_API_BASE_URL: `http://127.0.0.1:${address.port}`,
        OSV_REQUEST_TIMEOUT_MS: "10000",
        OSV_MAX_RETRIES: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(requested).toBe(true);
    expect(result).toEqual({ code: 4, signal: null });
    expect(output).not.toContain('"status": "COMPLETED"');
  } finally {
    clearTimeout(watchdog);
    child.kill();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
