import { existsSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { loadConfig, ConfigError } from "../config/load.js";
import { configSchema, type Config } from "../config/schema.js";
import { bootstrap, type Bootstrapped } from "../session/bootstrap.js";
import { getAppFrame } from "../browser/frame.js";
import { glideCursor, pulseCursor, showCursor, smoothScrollBy, MOTION } from "./motion.js";
import { detectBase } from "../git/base.js";
import { tryGit, GitError } from "../git/exec.js";
import { createBaseWorktree, type WorktreeHandle } from "../git/worktree.js";
import { detectPackageManager, installDependencies } from "../server/pkgManager.js";
import type { DevServerHandle } from "../server/devServer.js";
import { registerCleanup, runCleanups } from "../cli/cleanup.js";

export type ActionType = "click" | "fill" | "press" | "hover" | "navigate" | "scroll" | "wait";
export type RecordMode = "single" | "before-after";

export interface ActInput {
  action: ActionType;
  ref?: string;
  text?: string;
  key?: string;
  url?: string;
  ms?: number;
}

/** Short "YYYY-MM-DD HH:MM" caption stamp. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Compact filename stamp, e.g. 20260702-1108. */
function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const shortRef = (ref: string): string => ref.replace(/^origin\//, "");
const slug = (s: string): string =>
  shortRef(s).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "clip";

/**
 * Drives an agent-recorded session. Claude Code calls start → snapshot → act* →
 * (next_pass → act*) → finish. Under the hood this reuses the exact same engine
 * as `pr-preview run`: a real headed Chrome, the live screencast IS the clip,
 * and the in-page recorder captures each action. The actions come from Claude
 * (via aria-ref locators) instead of a human's hands — so it stays a real
 * capture, never a synthesized video.
 */
export class PreviewRecorder {
  private boot: Bootstrapped | null = null;
  private page: Page | null = null;
  private config: Config | null = null;
  private outDir = ".pr-preview/output";
  private mode: RecordMode = "single";
  private pass: "before" | "after" = "before";
  private started = false;

  // before/after bookkeeping
  private beforeServer: DevServerHandle | null = null;
  private worktree: WorktreeHandle | null = null;
  private baseLabel = "";
  private headLabel = "";
  private fstamp = "";
  private timestamp = "";
  private beforePaths: string[] = [];
  private fellBackToGif = false;

  constructor(private readonly repoRoot: string) {}

  get isActive(): boolean {
    return this.started;
  }

  /** Launch the browser + app and begin recording. Returns the first snapshot. */
  async start(opts: { url?: string; mode?: RecordMode } = {}): Promise<{ snapshot: string; startUrl: string; mode: RecordMode }> {
    if (this.started) throw new Error("A recording is already in progress — call finish_recording first.");
    this.mode = opts.mode ?? "single";
    if (this.mode === "before-after") return this.startBeforeAfter();
    return this.startSingle(opts.url);
  }

  private async startSingle(url?: string): Promise<{ snapshot: string; startUrl: string; mode: RecordMode }> {
    let config: Config;
    try {
      config = (await loadConfig(this.repoRoot)).config;
    } catch (err) {
      if (url && err instanceof ConfigError) config = configSchema.parse({ devCommand: "external", url });
      else throw err;
    }
    this.config = config;
    this.outDir = path.resolve(this.repoRoot, config.output);
    this.headLabel = await this.currentBranch();
    this.timestamp = stamp();
    this.fstamp = fileStamp();

    const boot = url
      ? await bootstrap(this.repoRoot, config, "run", { fixedUrl: url })
      : await bootstrap(this.repoRoot, config, "run");
    this.boot = boot;
    boot.session.setPasses(1);

    if (!url) await boot.startApp("before", this.repoRoot);
    const browser = await boot.openBrowser("before");
    this.page = browser.page;

    await this.beginRecording();
    this.started = true;
    return { snapshot: await this.snapshot(), startUrl: boot.session.startUrl, mode: this.mode };
  }

  private async startBeforeAfter(): Promise<{ snapshot: string; startUrl: string; mode: RecordMode }> {
    const config = (await loadConfig(this.repoRoot)).config; // config required for a managed dev server
    this.config = config;
    this.outDir = path.resolve(this.repoRoot, config.output);

    const currentBranch = await tryGit(this.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!currentBranch) {
      throw new GitError(
        "before/after recording needs you to be on a branch (detached HEAD).\n" +
          "Check out your PR branch first, or use single mode.",
      );
    }
    const base = await detectBase(this.repoRoot, config.baseBranch);
    this.baseLabel = shortRef(base.ref);
    this.headLabel = shortRef(currentBranch);
    this.timestamp = stamp();
    this.fstamp = fileStamp();

    // Base app runs from a detached worktree at the base commit.
    const worktree = await createBaseWorktree(this.repoRoot, base.sha);
    this.worktree = worktree;
    if (!config.keepWorktree) registerCleanup(() => worktree.remove());

    if (config.install !== "never") {
      const appDir = path.join(worktree.dir, config.cwd);
      const hasModules = existsSync(path.join(appDir, "node_modules"));
      if (config.install === "always" || !hasModules) {
        await installDependencies(appDir, detectPackageManager(appDir));
      }
    }

    const boot = await bootstrap(this.repoRoot, config, "run");
    this.boot = boot;
    boot.session.setPasses(2);
    boot.session.setBranches(base.ref, currentBranch);

    this.beforeServer = await boot.startApp("before", worktree.dir);
    const browser = await boot.openBrowser("before");
    this.page = browser.page;

    this.pass = "before";
    await this.beginRecording();
    this.started = true;
    return { snapshot: await this.snapshot(), startUrl: boot.session.startUrl, mode: this.mode };
  }

  /** before/after only: finish the BEFORE clip, switch to the branch app, start AFTER. */
  async nextPass(): Promise<{ snapshot: string }> {
    if (!this.started) throw new Error("No active recording — call start_recording first.");
    if (this.mode !== "before-after") throw new Error("next_pass is only valid in before-after mode.");
    if (this.pass !== "before") throw new Error("Already recording the AFTER pass.");
    const boot = this.boot!;

    boot.session.setPhase("idle");
    const before = await boot.session.encodeClip("before", this.outPath("before", this.baseLabel), {
      branch: this.baseLabel,
      baseBranch: this.baseLabel,
      timestamp: this.timestamp,
    });
    this.beforePaths = before.paths;
    this.fellBackToGif ||= before.fellBackToGif;

    // Swap the app: stop the base dev server, start the branch app in place.
    await this.beforeServer?.stop();
    await boot.startApp("after", this.repoRoot);
    boot.session.switchPass("after");
    await boot.switchApp("after");

    this.pass = "after";
    await this.beginRecording();
    return { snapshot: await this.snapshot() };
  }

  /** Accessibility tree of the app (with [ref=eN] handles) for Claude to target. */
  async snapshot(): Promise<string> {
    const frame = await this.frame();
    await frame.waitForLoadState("domcontentloaded").catch(() => {});
    return frame.locator("body").ariaSnapshot({ mode: "ai" });
  }

  /** Perform one action in the app, then return the fresh snapshot. Motions are
   *  animated in-page (synthetic-cursor glide, rAF scroll, per-character typing)
   *  so the live screencast captures continuous video, not a jumpy slideshow. */
  async act(a: ActInput): Promise<{ snapshot: string }> {
    if (!this.started) throw new Error("No active recording — call start_recording first.");
    const frame = await this.frame();
    switch (a.action) {
      case "click": {
        const loc = frame.locator(`aria-ref=${req(a.ref, "ref")}`);
        await this.glideToLocator(loc);
        await pulseCursor(frame); // ripple at the target as it's clicked
        await loc.click({ timeout: 15_000 });
        break;
      }
      case "fill": {
        const loc = frame.locator(`aria-ref=${req(a.ref, "ref")}`);
        await this.glideToLocator(loc);
        await loc.click({ timeout: 15_000 }); // focus the field
        await loc.fill("", { timeout: 15_000 }); // clear, then type it in for real
        await loc.pressSequentially(req(a.text, "text"), { delay: MOTION.typeDelayMs, timeout: 15_000 });
        break;
      }
      case "press": {
        // Glide the cursor onto the target first, so keyboard-driven activations
        // (e.g. answering a question when a native click is intercepted) still
        // read as the "hand" moving to the element and pressing it.
        const loc = frame.locator(`aria-ref=${req(a.ref, "ref")}`);
        const key = req(a.key, "key");
        await this.glideToLocator(loc);
        if (key === "Enter" || key === " " || key === "Spacebar") await pulseCursor(frame);
        await loc.press(key, { timeout: 15_000 });
        break;
      }
      case "hover": {
        const loc = frame.locator(`aria-ref=${req(a.ref, "ref")}`);
        await this.glideToLocator(loc);
        await loc.hover({ timeout: 15_000 });
        break;
      }
      case "scroll":
        if (a.ref) await this.smoothScrollToLocator(frame.locator(`aria-ref=${a.ref}`));
        else {
          const delta = await frame.evaluate(() => window.innerHeight * 0.8);
          await smoothScrollBy(frame, delta);
        }
        break;
      case "navigate": {
        const target = new URL(req(a.url, "url"), this.boot!.session.targetOrigin + "/").toString();
        await frame.goto(target, { waitUntil: "domcontentloaded" });
        await showCursor(await this.frame()); // re-render the pointer on the fresh page
        break;
      }
      case "wait":
        await this.page!.waitForTimeout(Math.min(a.ms ?? 1000, 15_000));
        break;
      default:
        throw new Error(`Unknown action: ${String((a as ActInput).action)}`);
    }
    await this.page!.waitForTimeout(MOTION.settleMs); // let the UI settle + the result render
    return { snapshot: await this.snapshot() };
  }

  /** Bring a target on-screen, then glide the synthetic cursor to its centre.
   *  Coordinates are frame-local (what the in-page cursor uses). */
  private async glideToLocator(loc: Locator): Promise<void> {
    await loc.scrollIntoViewIfNeeded({ timeout: 15_000 }).catch(() => {});
    const c = await loc
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })
      .catch(() => null);
    if (c) {
      await glideCursor(await this.frame(), c.x, c.y);
      await this.page!.waitForTimeout(MOTION.holdMs); // let the arrival frame land
    }
  }

  /** Smoothly scroll a target to the vertical centre of the viewport. The delta
   *  is measured inside the frame (frame-local coords). */
  private async smoothScrollToLocator(loc: Locator): Promise<void> {
    const delta = await loc
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 - window.innerHeight / 2;
      })
      .catch(() => null);
    if (delta === null) {
      await loc.scrollIntoViewIfNeeded({ timeout: 15_000 }).catch(() => {});
      return;
    }
    if (Math.abs(delta) < 8) return; // already centred
    await smoothScrollBy(await this.frame(), delta);
  }

  /** Stop recording, encode the final clip(s), and return the output file paths. */
  async finish(opts: { name?: string } = {}): Promise<{ files: string[]; fellBackToGif: boolean }> {
    if (!this.started) throw new Error("No active recording — call start_recording first.");
    if (this.mode === "before-after" && this.pass !== "after") {
      throw new Error("Record the AFTER pass first: call next_pass, redo the journey, then finish_recording.");
    }
    const boot = this.boot!;
    boot.session.setPhase("idle");

    let files: string[];
    if (this.mode === "before-after") {
      const after = await boot.session.encodeClip("after", this.outPath("after", this.headLabel), {
        branch: this.headLabel,
        baseBranch: this.baseLabel,
        timestamp: this.timestamp,
      });
      this.fellBackToGif ||= after.fellBackToGif;
      files = [...this.beforePaths, ...after.paths];
    } else {
      const clip = await boot.session.encodeClip("before", this.outPath("single", opts.name ?? this.headLabel), {
        branch: this.headLabel,
        baseBranch: this.headLabel,
        timestamp: this.timestamp,
      });
      this.fellBackToGif ||= clip.fellBackToGif;
      files = clip.paths;
    }

    const fellBack = this.fellBackToGif;
    await this.dispose();
    return { files, fellBackToGif: fellBack };
  }

  /** Tear everything down (browser, harness, dev servers, worktree) without encoding. */
  async dispose(): Promise<void> {
    this.started = false;
    this.boot = null;
    this.page = null;
    this.beforeServer = null;
    this.worktree = null;
    await runCleanups();
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private outPath(which: string, label: string): string {
    return path.join(this.outDir, `${which === "single" ? slug(label) : `${which}-${slug(label)}`}-${this.fstamp}`);
  }

  /** Capture the start path, then begin the live screencast recording. */
  private async beginRecording(): Promise<void> {
    const boot = this.boot!;
    const frame = await getAppFrame(this.page!, boot.session.targetOrigin);
    await frame.waitForLoadState("domcontentloaded").catch(() => {});
    boot.session.startUrl = await frame.evaluate(() => location.pathname + location.search).catch(() => "/");
    boot.session.setPhase("recording");
    await showCursor(frame); // render the pointer from the first frame, at rest
  }

  private async frame() {
    if (!this.page || !this.boot) throw new Error("No active recording.");
    return getAppFrame(this.page, this.boot.session.targetOrigin);
  }

  private async currentBranch(): Promise<string> {
    const ref = await tryGit(this.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return ref ? shortRef(ref) : "app";
  }
}

function req<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null || v === "") throw new Error(`Missing required "${name}" for this action.`);
  return v;
}
