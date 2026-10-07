// CI-only HTTPS transport around an actual Redis container; not a production Redis service.
import process from "node:process";
import https from "node:https";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
const server = https.createServer(
  { key: readFileSync(process.argv[2]), cert: readFileSync(process.argv[3]) },
  (request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) request.destroy();
    });
    request.on("end", () => {
      try {
        const command = JSON.parse(body);
        if (!Array.isArray(command) || command[0] !== "EVAL" || command.length !== 5) {
          response.writeHead(400).end();
          return;
        }
        execFile(
          "docker",
          ["exec", "agentshield-ops-redis", "redis-cli", "-p", "6380", "--raw", ...command],
          { timeout: 1500 },
          (error, stdout) => {
            if (error) {
              response.writeHead(503).end();
              return;
            }
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ result: stdout.trim().split("\n").map(Number) }));
          },
        );
      } catch {
        response.writeHead(400).end();
      }
    });
  },
);
server.listen(9443, "127.0.0.1");
