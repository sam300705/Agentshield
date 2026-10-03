import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { router as apiRouter } from "./apps/api/src/routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";

async function start() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Mount API and health endpoints
  app.use("/", apiRouter);

  if (!isProduction) {
    // In dev mode, mount Vite middleware
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: HOST,
      },
      appType: "spa",
      root: path.resolve(__dirname, "apps/web-dashboard"),
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve prebuilt assets
    const distPath = path.resolve(__dirname, "apps/web-dashboard/dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`AgentShield server listening on http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start AgentShield server:", err);
  process.exit(1);
});
