import type { CDPSession, Page } from "playwright";

export interface CapturedFrame {
  /** JPEG bytes straight from the screencast. */
  data: Buffer;
  /** ms since capture start, with paused windows removed. */
  t: number;
}

export interface ScreencastHandle {
  /** Drop incoming frames and compress the timeline (manual pauses). */
  pause(): void;
  resume(): void;
  stop(): Promise<CapturedFrame[]>;
  /** Frames captured so far (live) — used to mark where each step landed. */
  frameCount(): number;
  /** Drop frames after index `n` (re-record from a step in live capture). */
  truncate(n: number): void;
  /** Most recent frame's bytes — drives recording-time thumbnails. */
  latest(): Buffer | null;
}

/**
 * Capture frames via CDP Page.startScreencast — real video-rate frames with
 * timestamps, far smoother than interval screenshots for cursor motion.
 * Frames cover the whole page; cropping to the iframe happens at encode time.
 *
 * pause()/resume() cut manual-pause windows (user typing a password, fixing a
 * drifted step) out of the GIF entirely instead of baking in dead footage.
 */
export async function startScreencast(
  page: Page,
  opts: { quality?: number; everyNthFrame?: number; maxWidth?: number; maxHeight?: number } = {},
): Promise<ScreencastHandle> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const frames: CapturedFrame[] = [];
  let t0: number | null = null;
  let paused = false;
  let pauseBeganAbs: number | null = null;
  let removed = 0; // total ms cut from the timeline
  let lastAbs = 0;

  const onFrame = async (event: {
    data: string;
    sessionId: number;
    metadata: { timestamp?: number };
  }) => {
    const abs = (event.metadata.timestamp ?? Date.now() / 1000) * 1000;
    lastAbs = abs;
    if (t0 === null) t0 = abs;
    if (!paused) {
      frames.push({ data: Buffer.from(event.data, "base64"), t: abs - t0 - removed });
    }
    // Must ack every frame (even dropped ones) or Chrome stops sending.
    await cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);

  // maxWidth/maxHeight cap the JPEG Chrome encodes per frame. Left unset, Chrome
  // encodes the FULL window at device pixels (≈4× the pixels on a 2× display) —
  // that per-frame encode+transfer cost is what starves the delivered frame rate.
  // Capping to roughly the CSS window size defeats the Retina bloat, so Chrome
  // delivers many more frames/sec; the clip is downscaled at encode anyway.
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: opts.quality ?? 90,
    everyNthFrame: opts.everyNthFrame ?? 1,
    ...(opts.maxWidth ? { maxWidth: opts.maxWidth } : {}),
    ...(opts.maxHeight ? { maxHeight: opts.maxHeight } : {}),
  });

  return {
    frameCount() {
      return frames.length;
    },
    truncate(n: number) {
      if (n >= 0 && n < frames.length) frames.length = n;
    },
    latest() {
      return frames.length ? (frames[frames.length - 1]!.data) : null;
    },
    pause() {
      if (paused) return;
      paused = true;
      pauseBeganAbs = lastAbs;
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (pauseBeganAbs !== null) removed += Math.max(0, lastAbs - pauseBeganAbs);
      pauseBeganAbs = null;
    },
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      cdp.off("Page.screencastFrame", onFrame);
      await cdp.detach().catch(() => {});
      return frames;
    },
  };
}
