import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  if (env.VITE_APP_MODE === "live") {
    if (!env.VITE_API_BASE_URL?.startsWith("https://"))
      throw new Error("Live dashboard requires an HTTPS API origin");
    for (const name of [
      "ISSUER",
      "CLIENT_ID",
      "REDIRECT_URI",
      "AUTHORIZATION_ENDPOINT",
      "TOKEN_ENDPOINT",
      "JWKS_URI",
    ])
      if (!env[`VITE_OIDC_${name}`])
        throw new Error(`Missing public OIDC configuration: VITE_OIDC_${name}`);
  }
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
