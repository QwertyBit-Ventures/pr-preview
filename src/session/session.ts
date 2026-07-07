import sharp from "sharp";
import type { Page } from "playwright";
import type { Bus } from "../ipc/bus.js";
import type { PassInfo, Phase, StepSummary } from "../ipc/protocol.js";
import { StepBuilder } from "../recorder/steps.js";
import { describeStep, type RawEvent, type Step } from "../recorder/types.js";
import { startScreencast, type ScreencastHandle, type CapturedFrame } from "../capture/screencast.js";
import { cssRectToFramePixels } from "../capture/region.js";
import { encodeMedia, type MediaResult } from "../encode/media.js";
import { getAppFrame, getAppFrameRect } from "../browser/frame.js";
import type { Config } from "../config/schema.js";

/**
 * One interactive harness session. The clip IS the live recording: while the
 * user performs the journey we screencast the page (with a synthetic cursor
 * that follows the real mouse), then encode those frames directly — no replay,
 * so nothing can drift. Steps are recorded purely as a sidebar outline (with
 * thumbnails + re-record-from-a-point).
 */
export class Session {
  readonly builder = new StepBuilder();
  /** Path the journey starts on — captured when recording begins. */
  startUrl = "/";
  private phase: Phase = "idle";
  private page: Page | null = null;
  private thumbnailQueue = Promise.resolve();
  /** Full screencast kept alive during recording — its frames ARE the clip,
   *  and its latest frame drives the sidebar thumbnails. */
  private recordingFeed: ScreencastHandle | null = null;
  /** frames.length at the moment each step was recorded — lets a re-record
   *  truncate the footage at that step. */
  private frameMark = new Map<string, number>();
  private passInfo: PassInfo = {
    pass: "before",
    done: { before: false, after: false },
    resetStorage: true,
  };
  /** Single-recording session — the clip's caption drops the BEFORE/AFTER pill. */
  private singleClip = false;
  /** The confirmed BEFORE journey, offered as a starting point for AFTER. */
  private beforeJourney: { steps: Step[]; startUrl: string } | null = null;

  constructor(
    private readonly bus: Bus,
    private readonly config: Config,
    private readonly mode: "record" | "run",
    private appUrl: string,
  ) {
    this.passInfo.resetStorage = config.resetStorage;

    bus.onHello(() => ({
      type: "HELLO",
      phase: this.phase,
      steps: this.builder.getSteps().map(toSummary),
      appUrl: this.appUrl,
      mode: this.mode,
      passInfo: this.passInfo,
    }));

    // Manual refresh button in the iframe corner.
    bus.onMessage((msg) => {
      if (msg.type === "RELOAD_IFRAME") void this.reloadAppFrame();
    });

    this.builder.onChange((change) => {
      switch (change.kind) {
        case "added":
          // Mark where in the live footage this step landed (re-record + trim).
          if (this.recordingFeed) this.frameMark.set(change.step.id, this.recordingFeed.frameCount());
          bus.send({ type: "STEP_ADDED", step: toSummary(change.step) });
          this.scheduleThumbnail(change.step);
          break;
        case "updated":
          // Advance the mark as the step changes (a fill coalesces keystrokes),
          // so the end-trim keeps the WHOLE action — not just its first frame.
          if (this.recordingFeed) this.frameMark.set(change.step.id, this.recordingFeed.frameCount());
          bus.send({ type: "STEP_UPDATED", step: toSummary(change.step) });
          break;
        case "removed":
          bus.send({ type: "STEP_REMOVED", stepId: change.stepId });
          break;
        case "reset":
          bus.send({ type: "STEPS_RESET", steps: this.builder.getSteps().map(toSummary) });
          break;
      }
    });
  }

  attachPage(page: Page, appUrl: string): void {
    this.page = page;
    this.appUrl = appUrl;
  }

  get targetOrigin(): string {
    return new URL(this.appUrl).origin;
  }

  setPhase(phase: Phase, detail?: string): void {
    this.phase = phase;
    this.bus.send({ type: "PHASE_CHANGED", phase, detail });
    // The recording feed captures only while recording: start/resume on enter,
    // pause on leave (so STOP_RECORD / record-more gaps are cut from the clip).
    if (phase === "recording") void this.onEnterRecording();
    else void this.onLeaveRecording();
  }

  /** Set branch labels for the tab strip (run mode). */
  setBranches(before: string, after: string): void {
    this.passInfo = { ...this.passInfo, branches: { before, after } };
    this.bus.send({ type: "PASS_CHANGED", passInfo: this.passInfo });
  }

  /** Declare the session plan (1 = single clip, 2 = before/after) so the
   *  harness wizard/tabs render the right shape. */
  setPasses(passes: 1 | 2): void {
    this.singleClip = passes === 1;
    this.passInfo = { ...this.passInfo, passes };
    this.bus.send({ type: "PASS_CHANGED", passInfo: this.passInfo });
  }

  /**
   * Blocking nudge at the start of a pass, BEFORE recording: clear the app
   * (network/cookies/storage) and reload, or keep the current session. Shown
   * only when there's actually state to reset.
   */
  async promptResetChoice(): Promise<void> {
    if (!(await this.hasResettableState())) return;
    this.bus.send({
      type: "RESET_PROMPT",
      pass: this.passInfo.pass,
      defaultReset: this.config.resetStorage,
    });
    const { reset } = await this.bus.waitFor("RESET_CHOICE");
    this.passInfo = { ...this.passInfo, resetStorage: reset };
    this.bus.send({ type: "PASS_CHANGED", passInfo: this.passInfo });
    if (reset) await this.resetIframe();
  }

  /** Is there any cookie / localStorage / sessionStorage worth resetting? */
  private async hasResettableState(): Promise<boolean> {
    const page = this.page;
    if (!page) return false;
    try {
      const cookies = await page.context().cookies();
      if (cookies.length > 0) return true;
      const frame = await getAppFrame(page, this.targetOrigin, 5_000);
      return await frame.evaluate(() => localStorage.length > 0 || sessionStorage.length > 0);
    } catch {
      return false;
    }
  }

  /** Clear cookies + localStorage + sessionStorage and reload the app. */
  private async resetIframe(): Promise<void> {
    const page = this.page;
    if (!page) return;
    await page.context().clearCookies().catch(() => {});
    try {
      const frame = await getAppFrame(page, this.targetOrigin, 5_000);
      await frame.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch {
      /* frame not up — the reload starts clean anyway */
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await getAppFrame(page, this.targetOrigin)
      .then((f) => f.waitForLoadState("domcontentloaded").catch(() => {}))
      .catch(() => {});
  }

  /** Switch the session to the other pass; AFTER starts with a clean slate. */
  switchPass(pass: "before" | "after"): void {
    this.passInfo = { ...this.passInfo, pass };
    if (pass === "after") {
      // Keep the confirmed BEFORE journey around as an optional template.
      this.beforeJourney = { steps: this.builder.getSteps(), startUrl: this.startUrl };
      this.builder.setSteps([]);
      this.frameMark.clear();
      this.startUrl = "/";
      this.passInfo = { ...this.passInfo, resetStorage: this.config.resetStorage };
    }
    this.bus.send({ type: "PASS_CHANGED", passInfo: this.passInfo });
  }

  markGifDone(which: "before" | "after"): void {
    this.passInfo = { ...this.passInfo, done: { ...this.passInfo.done, [which]: true } };
    this.bus.send({ type: "PASS_CHANGED", passInfo: this.passInfo });
  }

  /** Raw events from the in-page recorder land here (via exposeBinding). */
  handleRawEvent = (event: RawEvent): void => {
    if (this.phase === "recording") this.builder.handle(event);
  };

  /** Reload the current page inside the app iframe (cross-origin safe via CDP). */
  private async reloadAppFrame(): Promise<void> {
    const page = this.page;
    if (!page) return;
    try {
      const frame = await getAppFrame(page, this.targetOrigin, 3_000);
      await frame.evaluate(() => location.reload());
    } catch {
      /* frame not up — nothing to reload */
    }
  }

  /**
   * Drive the interactive record/edit loop until the user confirms.
   * Resolves with the confirmed steps.
   */
  async recordUntilConfirmed(): Promise<Step[]> {
    return new Promise<Step[]>((resolve, reject) => {
      const off = this.bus.onMessage((msg) => {
        switch (msg.type) {
          case "START_RECORD":
            // A fresh recording defines the journey's start page.
            if (this.builder.getSteps().length === 0) {
              void this.currentAppPath().then((p) => (this.startUrl = p));
            }
            this.setPhase("recording");
            break;
          case "STOP_RECORD":
            this.setPhase("idle");
            break;
          case "DELETE_STEP":
            this.builder.removeStep(msg.stepId);
            break;
          case "RERECORD_FROM":
            // Drop the step + everything after (and the footage from that
            // point), then keep recording from there.
            this.truncateLiveFrames(msg.stepId);
            this.builder.truncateFrom(msg.stepId);
            this.setPhase("recording", "Re-recording — perform the journey from this point");
            break;
          case "LOAD_BEFORE_STEPS":
            // AFTER pass convenience: start the outline from the BEFORE journey.
            if (this.beforeJourney) {
              this.builder.setSteps(this.beforeJourney.steps);
              this.startUrl = this.beforeJourney.startUrl;
            }
            break;
          case "CONFIRM":
            this.setPhase("idle");
            off();
            resolve(this.builder.getSteps());
            break;
          case "ABORT":
            off();
            reject(new Error("Aborted from the sidebar"));
            break;
        }
      });
    });
  }

  private async currentAppPath(): Promise<string> {
    const page = this.page;
    if (!page) return "/";
    try {
      const frame = await getAppFrame(page, this.targetOrigin, 5_000);
      return await frame.evaluate(() => location.pathname + location.search);
    } catch {
      return "/";
    }
  }

  /** Enter recording: start the full screencast (or resume it) + tell the
   *  in-page cursor to follow the real mouse so it lands in the footage. */
  private async onEnterRecording(): Promise<void> {
    await this.setIframeRecording(true);
    if (this.recordingFeed) {
      this.recordingFeed.resume();
      return;
    }
    const page = this.page;
    if (!page) return;
    // Cap the capture to ~the CSS window size (bounded), so Chrome doesn't
    // JPEG-encode full device-pixel frames on Retina — that raises the delivered
    // frame rate. The clip is downscaled at encode, so this costs no real detail.
    const { maxWidth, maxHeight } = await page
      .evaluate(() => ({
        maxWidth: Math.min(window.innerWidth, 1920),
        maxHeight: Math.min(window.innerHeight, 1200),
      }))
      .catch(() => ({ maxWidth: 1920, maxHeight: 1200 }));
    try {
      this.recordingFeed = await startScreencast(page, { quality: 80, maxWidth, maxHeight });
    } catch {
      this.recordingFeed = null;
    }
  }

  /** Leave recording: pause the feed (keep its frames). */
  private async onLeaveRecording(): Promise<void> {
    this.recordingFeed?.pause();
    await this.setIframeRecording(false);
  }

  /** Fully stop the recording feed and return its frames (the clip). */
  private async takeRecordingFrames(): Promise<CapturedFrame[]> {
    const feed = this.recordingFeed;
    this.recordingFeed = null;
    if (!feed) return [];
    return feed.stop();
  }

  /** Re-record: drop the footage recorded from `stepId` onwards. */
  truncateLiveFrames(stepId: string): void {
    const mark = this.frameMark.get(stepId);
    if (mark != null) this.recordingFeed?.truncate(mark);
    for (const [id, n] of this.frameMark) if (mark != null && n >= mark) this.frameMark.delete(id);
  }

  /** Tell the in-page recorder to make the synthetic cursor follow the mouse. */
  private async setIframeRecording(on: boolean): Promise<void> {
    const page = this.page;
    if (!page) return;
    try {
      const frame = await getAppFrame(page, this.targetOrigin, 2_000);
      await frame.evaluate((v) => {
        window.__prPreviewRecording = v;
      }, on);
    } catch {
      /* frame not up yet */
    }
  }

  /**
   * Trim dead time at the ends of the footage: keep a small lead-in before the
   * first interaction and a short tail after the last, so "getting ready" and
   * "reaching for Confirm" time isn't baked into the clip.
   */
  private trimToActivity(frames: CapturedFrame[]): CapturedFrame[] {
    const marks = [...this.frameMark.values()]
      .filter((n) => n >= 0 && n < frames.length)
      .sort((a, b) => a - b);
    if (marks.length === 0) return frames;
    // Small lead-in; a generous tail so the result of the last action (e.g. the
    // text you just typed rendering) is never clipped — only the dead "reaching
    // for Confirm" time after it is trimmed.
    const HEAD = 12; // ~0.5s at 24fps
    const TAIL = 40; // ~1.6s at 24fps
    const head = Math.max(0, marks[0]! - HEAD);
    const tail = Math.min(frames.length, marks[marks.length - 1]! + TAIL);
    return frames.slice(head, tail);
  }

  /**
   * Encode the recorded footage into the clip — cropped to the iframe, with the
   * caption/watermark overlay. No replay, no state re-creation.
   */
  async encodeClip(
    which: "before" | "after",
    outBase: string,
    label?: { branch: string; baseBranch: string; timestamp: string },
  ): Promise<MediaResult> {
    const page = this.page;
    if (!page) throw new Error("No browser page attached");
    await this.setIframeRecording(false);
    const frames = this.trimToActivity(await this.takeRecordingFrames());
    if (frames.length === 0) throw new Error("No footage captured for the clip");

    const cropCss = await getAppFrameRect(page);
    const pageCssSize = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    this.setPhase("encoding", `Encoding ${which} clip`);
    const result = await encodeMedia(frames, {
      cropCss,
      pageCssSize,
      width: this.config.gif.width,
      fps: this.config.gif.fps,
      quality: this.config.gif.quality,
      maxColors: this.config.gif.maxColors,
      interpolate: this.config.gif.interpolate,
      smoothFps: this.config.gif.smoothFps,
      format: this.config.format,
      outBase,
      label: label ? { pass: this.singleClip ? "single" : which, ...label } : undefined,
      onProgress: (stage, done, total) =>
        this.bus.send({ type: "ENCODE_PROGRESS", which, stage, done, total }),
    });
    this.markGifDone(which);
    this.bus.send({ type: "GIF_READY", which, path: result.paths[0]! });
    return result;
  }

  /**
   * Crop the recording feed's latest frame to the iframe for the sidebar step
   * row. No discrete screenshot → no flicker on recorded actions.
   */
  private scheduleThumbnail(step: Step): void {
    const page = this.page;
    if (!page) return;
    this.thumbnailQueue = this.thumbnailQueue.then(async () => {
      try {
        const frame = this.recordingFeed?.latest();
        if (!frame) return; // no frame yet — skip rather than flash a capture
        const meta = await sharp(frame).metadata();
        if (!meta.width || !meta.height) return;
        const rect = await getAppFrameRect(page);
        const pageCss = await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }));
        const crop = cssRectToFramePixels(rect, { width: meta.width, height: meta.height }, pageCss);
        if (crop.width < 2 || crop.height < 2) return;
        const small = await sharp(frame)
          .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
          .resize(160)
          .png()
          .toBuffer();
        this.builder.setThumbnail(step.id, `data:image/png;base64,${small.toString("base64")}`);
      } catch {
        /* transient (reload/race) — the next step retries */
      }
    });
  }
}

function toSummary(step: Step): StepSummary {
  return {
    id: step.id,
    type: step.type,
    label: describeStep(step),
    thumbnail: step.thumbnail,
  };
}
