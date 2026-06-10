/**
 * Simulate a full `pr-preview run` end to end (no human recording): drives the
 * demo repo through a journey on the base branch and the PR branch, producing
 * real before.mp4 / after.mp4. Headed, so you can watch it happen.
 *
 *   npx tsx scripts/simulate-run.ts /tmp/pr-preview-demo
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { loadConfig } from "../src/config/load.js";
import { detectBase } from "../src/git/base.js";
import { tryGit } from "../src/git/exec.js";
import { createBaseWorktree } from "../src/git/worktree.js";
import { detectPackageManager, installDependencies } from "../src/server/pkgManager.js";
import { bootstrap } from "../src/session/bootstrap.js";
import { getAppFrame } from "../src/browser/frame.js";
import { parseServerMessage, serialize } from "../src/ipc/protocol.js";
import type { BrowserSession } from "../src/browser/launch.js";

const repoRoot = process.argv[2] ?? "/tmp/pr-preview-demo";
const { config } = await loadConfig(repoRoot);
const outDir = path.resolve(repoRoot, config.output);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = await detectBase(repoRoot);
const currentBranch = (await tryGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "HEAD";
console.log(`▶ base ${base.ref} (${base.sha.slice(0, 8)}) → branch ${currentBranch}`);

const worktree = await createBaseWorktree(repoRoot, base.sha);
const appDir = path.join(worktree.dir, config.cwd);
if (!existsSync(path.join(appDir, "node_modules"))) {
  console.log("▶ installing base worktree deps…");
  await installDependencies(appDir, detectPackageManager(appDir));
}

const boot = await bootstrap(repoRoot, config, "run");
boot.session.setBranches(base.ref, currentBranch);

// Answer the sensitive-password manual pause during capture.
let browser: BrowserSession;
function attachPauseAnswerer(): void {
  const ws = new WebSocket(`${boot.harness.url.replace("http", "ws")}/ws`);
  ws.on("message", (data) => {
    void (async () => {
      const msg = parseServerMessage(data.toString());
      if (msg?.type === "MANUAL_PAUSE" || msg?.type === "STEP_FAILED") {
        const frame = await getAppFrame(browser.page, boot.session.targetOrigin);
        await frame.locator('[data-testid="password"]').fill("demo").catch(() => {});
        ws.send(serialize({ type: "CONTINUE" }));
      }
    })();
  });
}

async function click(selector: string): Promise<void> {
  const frame = await getAppFrame(browser.page, boot.session.targetOrigin);
  await frame.locator(selector).waitFor({ state: "visible", timeout: 8000 });
  const c = await frame.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const rect = (await browser.page.locator("#app-frame").boundingBox())!;
  const scale = rect.width / config.viewport.width;
  await browser.page.mouse.click(rect.x + c.x * scale, rect.y + c.y * scale);
  await sleep(350);
}

async function recordJourney(): Promise<void> {
  boot.session.setPhase("recording");
  await click('[data-testid="email"]');
  await browser.page.keyboard.type("demo@example.com", { delay: 40 });
  await click('[data-testid="password"]');
  await browser.page.keyboard.type("demo", { delay: 40 });
  await click('[data-testid="login-btn"]');
  await (await getAppFrame(browser.page, boot.session.targetOrigin))
    .locator('[data-testid="new-todo"]')
    .waitFor({ timeout: 8000 });
  await click('[data-testid="new-todo"]');
  await browser.page.keyboard.type("Ship the redesign", { delay: 40 });
  await click('[data-testid="add-todo"]');
  await click('[data-testid="new-todo"]');
  await browser.page.keyboard.type("Cut the v1 release", { delay: 40 });
  await click('[data-testid="add-todo"]');
  boot.session.setPhase("idle");
}

const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const slug = (r: string) => r.replace(/^origin\//, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
const fstamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");

// ---- BEFORE (base worktree) -------------------------------------------------
const beforeServer = await boot.startApp("before", worktree.dir);
browser = await boot.openBrowser("before");
attachPauseAnswerer();
console.log("● recording BEFORE…");
await recordJourney();
const beforeSteps = boot.session.builder.getSteps();
console.log(`● capturing BEFORE (${beforeSteps.length} steps)…`);
const before = await boot.session.captureReplay(
  beforeSteps,
  "before",
  path.join(outDir, `before-${slug(base.ref)}-${fstamp}`),
  { branch: base.ref, baseBranch: base.ref, timestamp },
);
console.log(`✓ ${before.paths.map((p) => path.basename(p)).join(", ")}`);

// ---- AFTER (working tree) ---------------------------------------------------
await beforeServer.stop();
await boot.startApp("after", repoRoot);
boot.session.switchPass("after");
await boot.switchApp("after");
console.log("● recording AFTER…");
await recordJourney();
const afterSteps = boot.session.builder.getSteps();
console.log(`● capturing AFTER (${afterSteps.length} steps)…`);
const after = await boot.session.captureReplay(
  afterSteps,
  "after",
  path.join(outDir, `after-${slug(currentBranch)}-${fstamp}`),
  { branch: currentBranch, baseBranch: base.ref, timestamp },
);
console.log(`✓ ${after.paths.map((p) => path.basename(p)).join(", ")}`);

console.log("\n✓ Done:");
for (const p of [...before.paths, ...after.paths]) console.log("  " + p);

await browser.close();
await boot.harness.close();
await worktree.remove();
process.exit(0);
