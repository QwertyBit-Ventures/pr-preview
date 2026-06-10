import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Optional frame-busting headers (visit any page with ?xfo=1 first) to
 * exercise pr-preview's header-strip path.
 */
function xfoPlugin(): Plugin {
  return {
    name: "test-xfo-headers",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("xfo=1")) {
          res.setHeader("X-Frame-Options", "DENY");
          res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), xfoPlugin()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
