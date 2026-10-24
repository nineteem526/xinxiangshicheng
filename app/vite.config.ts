import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// The dev server listens on the LAN over self-signed HTTPS so a phone browser may open its camera
// (getUserMedia needs a secure context). The Python backend stays on 127.0.0.1; phones reach it only
// through this proxy, and the backend refuses everything except pairing for non-local peers.
const BACKEND = "http://127.0.0.1:8011";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: BACKEND, ws: true, xfwd: true },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
