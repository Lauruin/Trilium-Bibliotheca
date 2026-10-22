/**
 * vite.config.ts — dev/build configuration.
 *
 * Port discipline (see AGENTS.md): the Trilium mock (compose.yml) takes 8080; the dev
 * server takes 5173 (both are also asserted in tools/check.sh).
 *
 * Networking model: the app talks to Trilium *directly* from the browser
 * (no dev proxy). Cross-origin access is granted by the Trilium instance
 * itself via `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` (supported since v0.93.0,
 * see docs: Advanced Usage → Configuration → CORS). The compose.yml sets it
 * for the disposable mock; for a real instance the user sets the same option.
 * Direct (proxied) access keeps the production path and the dev path identical.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on all interfaces, like the odd-arcade dev server
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      // lizard3d.html is a standalone feel-test page for the Yggdrasil/lizard idea.
      input: { main: "index.html", lizard3d: "lizard3d.html" },
    },
    // Phaser is large; a chunk-size warning is expected and harmless here.
    chunkSizeWarningLimit: 2000,
  },
});