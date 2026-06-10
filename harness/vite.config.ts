import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [preact()],
  build: {
    outDir: path.resolve(__dirname, "../dist/harness"),
    emptyOutDir: true,
  },
});
