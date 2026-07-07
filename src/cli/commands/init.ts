import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
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

/**
 * Register the MCP server in .mcp.json so Claude Code can drive recordings from
 * a prompt. Merges into an existing file rather than clobbering other servers.
 */
async function writeMcpConfig(root: string): Promise<void> {
  const mcpPath = path.join(root, ".mcp.json");
  const entry = { command: "npx", args: ["pr-preview", "mcp"] };

  let doc: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    try {
      doc = JSON.parse(await readFile(mcpPath, "utf8")) as typeof doc;
    } catch {
      log.warn(".mcp.json exists but isn't valid JSON — leaving it untouched.");
      return;
    }
  }
  doc.mcpServers ??= {};
  if (doc.mcpServers["pr-preview"]) {
    const overwrite = await log.confirm(
      ".mcp.json already has a pr-preview server. Overwrite it?",
    );
    if (!overwrite) {
      log.warn("Left the existing pr-preview MCP server untouched.");
      return;
    }
  }
  doc.mcpServers["pr-preview"] = entry;
  await writeFile(mcpPath, JSON.stringify(doc, null, 2) + "\n");
  log.success(`${existsSync(mcpPath) ? "Updated" : "Created"} .mcp.json (pr-preview MCP server for Claude Code)`);
}

const RECORD_SKILL = `---
name: record
description: Record a video of a user journey through a web app, automatically, using PR Preview (@qwertybit/pr-preview). Claude drives the app itself and produces an MP4 — no human clicking. Usage: /record [url] [journey in plain English]. Use when the user wants to record, film, or capture a walkthrough or before/after video of an app for a pull request or demo.
---

# /record — record an app journey automatically with PR Preview

You record a real video walkthrough of a web app by **driving it yourself** through the
PR Preview MCP server — not by asking the user to click. PR Preview opens its harness (a
visible Chrome window with the app in an iframe and a step sidebar); you perform the
journey through its tools and it captures a clean, PR-ready MP4.

## Arguments
\`/record [url] [journey]\`
- **url** (optional): the app to record, e.g. \`http://localhost:3000\` or \`https://staging.example.com\`. The first URL-looking token is the URL; the rest is the journey.
- **journey** (optional): what to do, in plain English (e.g. "add 3 books to the cart, then go to checkout").

## Preconditions
The PR Preview MCP tools must be connected: \`start_recording\`, \`snapshot\`, \`act\`,
\`next_pass\`, \`finish_recording\`, \`open_pr\`, \`detect_localhost\`.
- If they are NOT available, tell the user to install and connect it:
  \`npm i -D @qwertybit/pr-preview\` → \`npx pr-preview init\` (writes \`.mcp.json\`) → reload Claude Code.
  Stop until it's connected.

## Steps
1. **Resolve the URL.** If a URL was given, use it. Otherwise call \`detect_localhost\`; if apps
   are running, ask the user which to record; if none are, ask for a local, staging, or
   production URL. **Never guess.**
2. **Start.** Call \`start_recording\` with \`{ url }\`. A Chrome window opens with the harness —
   the app runs in the iframe and the sidebar records each step. Do NOT click "Start recording";
   \`start_recording\` already began it. (For a base-vs-branch PR comparison, use
   \`{ mode: "before-after" }\` with a managed dev server instead.)
3. **Drive the journey.** Read the returned accessibility snapshot. For each step in the journey,
   call \`act\` (\`click\` / \`fill\` / \`press\` / \`hover\` / \`navigate\` / \`scroll\`), targeting elements
   by their \`[ref=…]\` handle. Take a fresh snapshot after any step that changes the page. Perform
   the journey faithfully — **you drive it; never ask the user to click.**
4. **Finish.** Call \`finish_recording\` and report the output MP4 path.
5. **PR (optional).** If the user asked, call \`open_pr\` with the produced file(s).

## Important
- This is agent-driven but a REAL capture of the real app — nothing is synthesized.
- Do NOT use the \`pr-preview run\` CLI for this — that is the manual, human-in-the-loop flow that
  waits for a person to click. Always drive via the MCP tools above so recording is automatic.
`;

/**
 * Install the /record slash command so users can run "/record <url> <journey>"
 * right after init. Non-destructive: skips if a skill already exists there.
 */
async function writeRecordSkill(root: string): Promise<void> {
  const skillDir = path.join(root, ".claude", "skills", "record");
  const skillPath = path.join(skillDir, "SKILL.md");
  if (existsSync(skillPath)) {
    const overwrite = await log.confirm(
      ".claude/skills/record/SKILL.md already exists. Overwrite it?",
    );
    if (!overwrite) {
      log.warn("Left the existing /record skill untouched.");
      return;
    }
  }
  await mkdir(skillDir, { recursive: true });
  await writeFile(skillPath, RECORD_SKILL);
  log.success("Installed the /record slash command (.claude/skills/record/SKILL.md)");
}

export async function initCommand(root: string): Promise<void> {
  const configPath = path.join(root, "pr-preview.config.js");
  const existingConfig = [".js", ".ts", ".json"]
    .map((ext) => path.join(root, `pr-preview.config${ext}`))
    .find(existsSync);
  if (existingConfig) {
    const overwrite = await log.confirm(
      `A pr-preview config already exists (${path.basename(existingConfig)}). Overwrite it?`,
    );
    if (overwrite) {
      await writeFile(existingConfig, CONFIG_TEMPLATE);
      log.success(`Overwrote ${path.basename(existingConfig)}`);
    } else {
      log.warn("Left the existing pr-preview config untouched.");
    }
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

  await writeMcpConfig(root);
  await writeRecordSkill(root);

  log.info("Edit the config to match your dev command, then run `pr-preview run` on a PR branch.");
  log.info("Or ask Claude Code to record a flow for you (e.g. “record my add-to-cart flow”),");
  log.info("or run the /record slash command: `/record localhost:3000 add a book, then checkout`.");
}
