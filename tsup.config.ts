import { defineConfig } from "tsup";

export default defineConfig([
  // Node CLI bundle
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    sourcemap: true,
    clean: false,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
    // Keep heavy/native deps external; they live in node_modules at runtime.
    external: ["playwright", "sharp", "ws", "jiti"],
  },
  // In-page recorder, bundled as an IIFE string that Node injects via addInitScript
  {
    entry: { "inpage/recorder": "src/recorder/inpage/index.ts" },
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    sourcemap: false,
    clean: false,
    dts: false,
    minify: false,
  },
]);
