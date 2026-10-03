import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgresql://agentshield:agentshield@localhost:5432/agentshield?schema=public",
      REDIS_URL: "redis://127.0.0.1:6379"
    }
  }
});
