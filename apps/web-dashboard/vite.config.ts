import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  return {
    envDir: "../..",
    plugins: [react()],
    server: {
      port: Number(process.env.WEB_PORT ?? env.WEB_PORT ?? 5173),
      strictPort: true,
    },
    preview: {
      port: 4173,
    },
  };
});
