import { existsSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadConfig, ConfigError } from "../../config/load.js";
import { configSchema, type Config } from "../../config/schema.js";
import { detectBase } from "../../git/base.js";
import { tryGit, GitError } from "../../git/exec.js";
import { createBaseWorktree } from "../../git/worktree.js";
import { detectPackageManager, installDependencies } from "../../server/pkgManager.js";
import { bootstrap } from "../../session/bootstrap.js";
import type { Session } from "../../session/session.js";
import { saveJourney } from "../../recorder/journey.js";
import type { Step } from "../../recorder/types.js";
import { log } from "../ui/logger.js";
import { revealFiles } from "../util/openPath.js";
import { registerCleanup, runCleanups } from "../cleanup.js";
import { printTeamsPromo } from "../../branding.js";

/** Encode the recorded footage for one pass into its clip. */
function captureClip(
  session: Session,
  which: "before" | "after",
  outBase: string,
  label: { branch: string; baseBranch: string; timestamp: string },
) {
  return session.encodeClip(which, outBase, label);
}

/** Short, human "YYYY-MM-DD HH:MM" for the burned-in caption. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Trim noisy ref prefixes for the on-clip label (origin/main → main). */
function shortRef(ref: string): string {
  return ref.replace(/^origin\//, "");
}

/** Filesystem-safe slug for a branch name (feature/demo → feature-demo). */
function slug(ref: string): string {
  return shortRef(ref).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Compact timestamp for filenames, e.g. 20260608-1108. */
function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export interface RunOptions {
  base?: string;
  keepWorktree?: boolean;
  /** Use an already-running app at this URL instead of a managed dev server. */
  url?: string;
  /** Record a single standalone clip (no before/after). Forces passes = 1. */
  single?: boolean;
}

/** Current branch name (slugged), or a fallback when not in a git repo. */
async function branchName(repoRoot: string, fallback: string): Promise<string> {
  const ref = await tryGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return ref ? shortRef(ref) : fallback;
}

/**
 * The product flow — each pass is recorded on its own version, because the
 * before and after UIs may share nothing:
 *
 *   BEFORE (base worktree): user records → Confirm → replay+capture → before.gif
 *   AFTER (working tree):   user records again (or loads the BEFORE steps as a
 *                           starting point) → Save → replay+capture → after.gif
 */
export async function runCommand(repoRoot: string, opts: RunOptions): Promise<void> {
  let config: Config;
  const urlFlag = opts.url; // may also come from config.externalUrl below
  try {
    config = (await loadConfig(repoRoot)).config;
  } catch (err) {
    // In --url mode the dev command/url are unused, so a config file is optional.
    if (urlFlag && err instanceof ConfigError) {
      config = configSchema.parse({ devCommand: "external", url: urlFlag });
    } else {
      throw err;
    }
  }

  // CLI flags override config; otherwise fall back to config defaults so a
  // project can be set up once and run with just `pr-preview run` (handy for
  // CI and scripting).
  opts = {
    url: opts.url ?? config.externalUrl,
    base: opts.base ?? config.baseBranch,
    keepWorktree: opts.keepWorktree ?? config.keepWorktree,
    single: opts.single,
  };
  const outDir = path.resolve(repoRoot, config.output);
  const passes: 1 | 2 = opts.single ? 1 : config.passes;

  if (passes === 1) return runSingleClip(repoRoot, config, outDir, opts);
  if (opts.url) return runWithExternalApp(repoRoot, config, outDir, opts);

  try {
    // ---- 1. base worktree ---------------------------------------------------
    // Pre-flight: a before/after run needs a named branch to compare against
    // its base. (detectBase covers "no repo" / "no commits" / "no base".)
    const currentBranch = await tryGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!currentBranch) {
      throw new GitError(
        "You're not on a branch (detached HEAD).\n\n" +
          "`pr-preview run` records the BEFORE on your PR's base branch and the AFTER on your\n" +
          "current branch — so it needs you to be on a branch. Check yours out first:\n" +
          "    git switch <your-branch>\n\n" +
          "…or skip the comparison and just record the current app:\n" +
          "    pr-preview run --single",
      );
    }

    const base = await detectBase(repoRoot, opts.base ?? config.baseBranch);
    log.info(`PR base: ${pc.bold(base.ref)} (${base.sha.slice(0, 10)}, via ${base.source})`);

    // The AFTER pass records your current working tree, so flag uncommitted work.
    if (await tryGit(repoRoot, ["status", "--porcelain"])) {
      log.info("Heads up: the AFTER clip captures your working tree, including uncommitted changes.");
    }

    const worktree = await createBaseWorktree(repoRoot, base.sha);
    if (!opts.keepWorktree) registerCleanup(() => worktree.remove());
    log.success(`Base worktree at ${path.relative(repoRoot, worktree.dir)}`);

    if (config.install !== "never") {
      const appDir = path.join(worktree.dir, config.cwd);
      const pm = detectPackageManager(appDir);
      const hasModules = existsSync(path.join(appDir, "node_modules"));
      if (config.install === "always" || !hasModules) {
        const spinner = log.spinner(`Installing dependencies in worktree (${pm}) …`);
        try {
          await installDependencies(appDir, pm);
          spinner.succeed("Worktree dependencies installed");
        } catch (err) {
          spinner.fail("Install failed");
          throw err;
        }
      }
    }

    // ---- 2. BEFORE pass ------------------------------------------------------
    const boot = await bootstrap(repoRoot, config, "run");
    boot.session.setPasses(2);
    boot.session.setBranches(base.ref, currentBranch);

    const beforeServer = await boot.startApp("before", worktree.dir);
    await boot.openBrowser("before");
    log.info(`Harness open at ${pc.bold(boot.harness.url)}`);

    log.step(`Record the journey on BEFORE (${base.ref}), then Confirm in the sidebar.`);

    await boot.session.promptResetChoice(); // reset/keep the app, then record
    const beforeSteps: Step[] = await boot.session.recordUntilConfirmed();
    if (beforeSteps.length === 0) throw new Error("No steps recorded for BEFORE — aborting.");
    await saveJourneyFile(repoRoot, "journey-before.json", config, boot.session.startUrl, beforeSteps, base.sha);

    const timestamp = stamp();
    const fstamp = fileStamp();
    const baseLabel = shortRef(base.ref);
    const headLabel = shortRef(currentBranch);

    log.info("Capturing BEFORE …");
    const before = await captureClip(boot.session,
      "before",
      path.join(outDir, `before-${slug(base.ref)}-${fstamp}`),
      { branch: baseLabel, baseBranch: baseLabel, timestamp },
    );
    if (before.fellBackToGif) {
      log.warn("ffmpeg not found — produced a GIF instead of MP4 (brew install ffmpeg).");
    }
    log.success(`${before.paths.map((p) => path.basename(p)).join(" + ")} (${before.frameCount} frames)`);

    // ---- 3. AFTER pass --------------------------------------------------------
    await beforeServer.stop();
    await boot.startApp("after", repoRoot);
    boot.session.switchPass("after"); // stores BEFORE steps as an optional template
    await boot.switchApp("after");
    boot.session.setPhase("idle"); // back to interactive — AFTER recording starts

    log.step(
      `Now record the journey on AFTER (${currentBranch}) — the UI may differ. ` +
        `Record fresh or load the BEFORE steps, then Save.`,
    );
    await boot.session.promptResetChoice(); // reset/keep the app, then record
    const afterSteps: Step[] = await boot.session.recordUntilConfirmed();
    if (afterSteps.length === 0) throw new Error("No steps recorded for AFTER — aborting.");
    await saveJourneyFile(repoRoot, "journey-after.json", config, boot.session.startUrl, afterSteps);

    log.info("Capturing AFTER …");
    const after = await captureClip(boot.session,
      "after",
      path.join(outDir, `after-${slug(currentBranch)}-${fstamp}`),
      { branch: headLabel, baseBranch: baseLabel, timestamp },
    );
    log.success(`${after.paths.map((p) => path.basename(p)).join(" + ")} (${after.frameCount} frames)`);

    boot.session.setPhase("done");
    boot.harness.bus.send({
      type: "DONE",
      outputs: { before: before.paths[0], after: after.paths[0] },
    });

    console.log();
    log.success(pc.bold("Done — drag these into your PR description:"));
    for (const p of [...before.paths, ...after.paths]) {
      log.step(path.relative(repoRoot, p));
    }
    // Reveal the produced clips in the file manager (selected).
    revealFiles([...before.paths, ...after.paths], outDir);
    printTeamsPromo();
  } finally {
    await runCleanups();
  }
}

/**
 * Single-recording flow (`--single` / `passes: 1`): record ONE journey on the
 * current app and save one clip — no before/after, no base worktree. Works with
 * a managed dev server (current working tree) or your own running app (`--url`).
 */
async function runSingleClip(
  repoRoot: string,
  config: Config,
  outDir: string,
  opts: RunOptions,
): Promise<void> {
  try {
    const boot = opts.url
      ? await bootstrap(repoRoot, config, "run", { fixedUrl: opts.url })
      : await bootstrap(repoRoot, config, "run");
    boot.session.setPasses(1); // single-clip wizard (no before/after tabs)
    const branch = await branchName(repoRoot, "app");

    let server;
    if (opts.url) {
      log.info(`Using your running app at ${pc.bold(opts.url)} (single clip).`);
    } else {
      // No base worktree — just run the current project's dev server.
      server = await boot.startApp("before", repoRoot);
    }
    await boot.openBrowser("before");
    log.info(`Harness open at ${pc.bold(boot.harness.url)}`);

    log.step(`Record the journey, then Confirm to save the clip.`);

    await boot.session.promptResetChoice();
    const steps: Step[] = await boot.session.recordUntilConfirmed();
    if (steps.length === 0) throw new Error("No steps recorded — aborting.");
    await saveJourneyFile(repoRoot, "journey.json", config, boot.session.startUrl, steps);

    const timestamp = stamp();
    log.info("Capturing the clip …");
    const clip = await captureClip(
      boot.session,
      "before",
      path.join(outDir, `${slug(branch)}-${fileStamp()}`),
      { branch, baseBranch: branch, timestamp },
    );
    if (clip.fellBackToGif) {
      log.warn("ffmpeg not found — produced a GIF instead of MP4 (brew install ffmpeg).");
    }
    await server?.stop();

    boot.session.setPhase("done");
    boot.harness.bus.send({ type: "DONE", outputs: { before: clip.paths[0] } });
    console.log();
    log.success(pc.bold("Done — your clip:"));
    for (const p of clip.paths) log.step(path.relative(repoRoot, p));
    revealFiles(clip.paths, outDir);
    printTeamsPromo();
  } finally {
    await runCleanups();
  }
}

/**
 * `--url` flow: the user runs the app themselves. We record BEFORE on their
 * running app, pause while they switch branches + restart it on the same URL,
 * then record AFTER. No git worktree, no managed dev server.
 */
async function runWithExternalApp(
  repoRoot: string,
  config: Config,
  outDir: string,
  opts: RunOptions,
): Promise<void> {
  log.info(`Using your running app at ${pc.bold(opts.url!)} (no dev server managed).`);
  try {
    const boot = await bootstrap(repoRoot, config, "run", { fixedUrl: opts.url });
    boot.session.setPasses(2);
    const beforeBranch = await branchName(repoRoot, "before");
    boot.session.setBranches(beforeBranch, "your PR branch");
    await boot.openBrowser("before");
    log.info(`Harness open at ${pc.bold(boot.harness.url)}`);

    log.step(`Record the journey on your app (currently ${beforeBranch}), then Confirm.`);
    await boot.session.promptResetChoice(); // reset/keep the app, then record
    const beforeSteps: Step[] = await boot.session.recordUntilConfirmed();
    if (beforeSteps.length === 0) throw new Error("No steps recorded for BEFORE — aborting.");

    const timestamp = stamp();
    const fstamp = fileStamp();
    await saveJourneyFile(repoRoot, "journey-before.json", config, boot.session.startUrl, beforeSteps);

    log.info("Capturing BEFORE …");
    const before = await captureClip(boot.session,
      "before",
      path.join(outDir, `before-${slug(beforeBranch)}-${fstamp}`),
      { branch: beforeBranch, baseBranch: beforeBranch, timestamp },
    );
    log.success(`${before.paths.map((p) => path.basename(p)).join(" + ")} (${before.frameCount} frames)`);

    // Hand off: the user switches their app to the PR branch and restarts it.
    log.info(pc.bold("→ Switch your app to the PR branch and restart it on the same URL, then Continue in the harness."));
    boot.harness.bus.send({
      type: "MANUAL_PAUSE",
      stepId: null,
      kind: "generic",
      label: `Switch your app to your PR branch and restart it on ${opts.url}, then click Continue.`,
    });
    await boot.harness.bus.waitFor("CONTINUE");

    const afterBranch = await branchName(repoRoot, "after");
    boot.session.switchPass("after"); // stashes BEFORE steps as a template
    boot.session.setBranches(beforeBranch, afterBranch);
    await boot.switchApp("after"); // reload the same URL → now the PR-branch app
    boot.session.setPhase("idle");

    log.step(`Now record the journey on AFTER (${afterBranch}) — record fresh or load the BEFORE steps, then Save.`);
    await boot.session.promptResetChoice(); // reset/keep the app, then record
    const afterSteps: Step[] = await boot.session.recordUntilConfirmed();
    if (afterSteps.length === 0) throw new Error("No steps recorded for AFTER — aborting.");
    await saveJourneyFile(repoRoot, "journey-after.json", config, boot.session.startUrl, afterSteps);

    log.info("Capturing AFTER …");
    const after = await captureClip(boot.session,
      "after",
      path.join(outDir, `after-${slug(afterBranch)}-${fstamp}`),
      { branch: afterBranch, baseBranch: beforeBranch, timestamp },
    );
    log.success(`${after.paths.map((p) => path.basename(p)).join(" + ")} (${after.frameCount} frames)`);

    boot.session.setPhase("done");
    boot.harness.bus.send({ type: "DONE", outputs: { before: before.paths[0], after: after.paths[0] } });
    console.log();
    log.success(pc.bold("Done — drag these into your PR description:"));
    for (const p of [...before.paths, ...after.paths]) log.step(path.relative(repoRoot, p));
    revealFiles([...before.paths, ...after.paths], outDir);
    printTeamsPromo();
  } finally {
    await runCleanups();
  }
}

async function saveJourneyFile(
  repoRoot: string,
  name: string,
  config: { viewport: { width: number; height: number } },
  startUrl: string,
  steps: Step[],
  baseRef?: string,
): Promise<void> {
  await saveJourney(path.join(repoRoot, ".pr-preview", name), {
    version: 1,
    createdAt: new Date().toISOString(),
    baseRef,
    viewport: { ...config.viewport, deviceScaleFactor: 2 },
    startUrl,
    steps,
  });
}
