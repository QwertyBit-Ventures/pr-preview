import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { log } from "../ui/logger.js";

const CONFIG_TEMPLATE = `/** @type {import('pr-preview').Config} */
export default {
  // ── App under preview ────────────────────────────────────────────────
  // Command that starts your dev server. $PORT is set for you.
  devCommand: "npm run dev",
  // Where the app answers once ready. {port} is replaced with the allocated port.
  url: "http://localhost:{port}",
  // Frontend directory relative to the repo root (monorepos).
  cwd: ".",
  // How long to wait for the dev server (ms).
  readyTimeout: 60000,

  // ── Run options (set here once instead of passing CLI flags every time) ─
  // Use an app YOU already run instead of a managed dev server. Set this for
  // apps that need real env/backends.
  // externalUrl: "http://localhost:3000",
  // Override PR-base ("before") detection, e.g. "origin/main".
  // baseBranch: undefined,
  // Reuse the base worktree across runs (skips reinstall).
  // keepWorktree: false,
  // 2 (default) = before/after comparison; 1 = a single standalone clip.
  // (run --single forces 1.)
  passes: 2,

  // ── Output ───────────────────────────────────────────────────────────
  output: ".pr-preview/output",
  format: "mp4", // "mp4" | "gif" | "both"
  // Start-of-pass reset choice default: true offers "reset to a clean app",
  // false offers "keep my session". The nudge only shows when there's state.
  resetStorage: true,
  viewport: { width: 1920, height: 1080 },

  // ── Permissions ──────────────────────────────────────────────────────
  // Grant browser permissions so apps that ask for them work (others stay
  // denied silently — no native prompt blocks the run).
  // permissions: ["geolocation", "clipboard-read", "clipboard-write"],
  // geolocation: { latitude: 51.5074, longitude: -0.1278 }, // fixed = deterministic
};
`;

const GITIGNORE_BLOCK = `
# pr-preview (worktrees, recordings, output)
.pr-preview/
`;

export async function initCommand(root: string): Promise<void> {
  const configPath = path.join(root, "pr-preview.config.js");
  if (
    existsSync(configPath) ||
    existsSync(path.join(root, "pr-preview.config.ts")) ||
    existsSync(path.join(root, "pr-preview.config.json"))
  ) {
    log.warn("A pr-preview config already exists — leaving it untouched.");
  } else {
    await writeFile(configPath, CONFIG_TEMPLATE);
    log.success(`Created ${path.basename(configPath)}`);
  }

  const gitignorePath = path.join(root, ".gitignore");
  const current = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : "";
  if (!current.includes(".pr-preview/")) {
    await appendFile(gitignorePath, GITIGNORE_BLOCK);
    log.success("Added .pr-preview/ to .gitignore");
  }

  log.info("Edit the config to match your dev command, then run `pr-preview run` on a PR branch.");
}
