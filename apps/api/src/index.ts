import { startServer } from "./server.js";
import { prisma } from "./db/prisma.js";

const server = startServer();
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  console.warn(JSON.stringify({ level: "info", service: "agentshield-api", message: "draining" }));
  server.close(() => {
    void prisma.$disconnect().then(() => {
      process.exitCode = 0;
    });
  });
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 110_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
