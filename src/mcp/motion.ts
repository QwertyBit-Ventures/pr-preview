import type { Frame } from "playwright";

/**
 * Human-like motion for the agent recorder.
 *
 * The clip is a live CDP screencast, which only emits a frame when the page
 * repaints. Instant Playwright actions (teleport click, `fill`, `scrollBy`)
 * change nothing *over time*, so the screencast captures a few static states
 * and the result looks like a slideshow.
 *
 * The smooth path is to animate *inside the page* with requestAnimationFrame:
 * one `frame.evaluate` kicks off a 60fps animation and resolves when it's done.
 * That is both smoother (every rAF tick repaints → a screencast frame) and
 * faster to drive (a single round-trip, not one per step) than nudging the real
 * OS mouse from Node. The synthetic cursor (`window.__prPreviewCursor`, injected
 * into the app frame) is the only pointer the screencast can show, so we move
 * that — the real click/scroll is applied separately by Playwright.
 */

export interface Point {
  x: number;
  y: number;
}

/** Durations (ms) tuned for a snappy-but-readable pace. Motions used to be
 *  deliberately slow so a low-fps screencast could catch enough frames along
 *  each path — but the capture is now capped to ~CSS size and delivers ~60fps
 *  during motion, so that constraint is gone. These are back at a natural human
 *  tempo; the clip feels responsive instead of dragging. */
export const MOTION = {
  glideMs: 750, // ceiling; the cursor scales the actual glide by distance
  scrollMs: 600,
  typeDelayMs: 35,
  settleMs: 140,
  holdMs: 80, // brief pause after a glide lands, before the click, so the
  // arrival + click-pulse frames are captured
} as const;

/**
 * Glide the synthetic cursor to a frame-local point over ~`ms`, animated in-page
 * at rAF rate. Resolves when the glide finishes. No-op (resolves) if the cursor
 * isn't installed.
 */
export async function glideCursor(
  frame: Frame,
  x: number,
  y: number,
  ms: number = MOTION.glideMs,
): Promise<void> {
  await frame
    .evaluate(
      ({ x, y, ms }) =>
        (window.__prPreviewCursor?.moveTo(x, y, ms) as Promise<void> | undefined) ??
        Promise.resolve(),
      { x, y, ms },
    )
    .catch(() => {});
}

/** Render the synthetic cursor at a frame-local point (defaults to the viewport
 *  centre) without animating. Used to keep the pointer visible during idle gaps
 *  — at the start of the clip and after each navigation — so the "hand" is
 *  always on screen, not just mid-glide. No-op if the cursor isn't installed. */
export async function showCursor(frame: Frame, x?: number, y?: number): Promise<void> {
  await frame
    .evaluate(
      ({ x, y }) => {
        const c = window.__prPreviewCursor;
        if (!c) return;
        c.show(x ?? (window.innerWidth || 1280) / 2, y ?? (window.innerHeight || 800) / 2);
      },
      { x: x ?? null, y: y ?? null },
    )
    .catch(() => {});
}

/** Pulse the synthetic cursor's click ring at its current spot. */
export async function pulseCursor(frame: Frame): Promise<void> {
  await frame
    .evaluate(
      () => (window.__prPreviewCursor?.clickPulse() as Promise<void> | undefined) ?? Promise.resolve(),
    )
    .catch(() => {});
}

/**
 * Smoothly scroll the frame's window by `deltaY` px over ~`ms`, animated in-page
 * with an ease-in-out curve so it accelerates and settles like a real flick.
 * Resolves when the scroll completes.
 */
export async function smoothScrollBy(
  frame: Frame,
  deltaY: number,
  ms: number = MOTION.scrollMs,
): Promise<void> {
  await frame
    .evaluate(
      ({ deltaY, ms }) =>
        new Promise<void>((resolve) => {
          const startY = window.scrollY;
          const t0 = performance.now();
          const ease = (t: number) =>
            t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const tick = (now: number) => {
            const t = Math.min(1, (now - t0) / ms);
            window.scrollTo(0, startY + deltaY * ease(t));
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        }),
      { deltaY, ms },
    )
    .catch(() => {});
}
