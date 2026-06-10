import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // E2E files each spawn a dev server + headed/headless Chrome. Running them
    // in parallel causes port/CPU contention (dev servers fail to come up in
    // time). Run files one at a time; the unit tests are fast either way.
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
});
