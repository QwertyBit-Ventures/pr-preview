import type { CapturedFrame } from "./screencast.js";

/**
 * Resample variable-rate screencast frames onto a fixed-fps timeline by
 * nearest preceding frame. Consecutive duplicates are kept (GIF needs the
 * delay anyway) but identical buffers are reused by reference, so later
 * stages can cheap-compare with ===.
 */
export function resampleToFps(frames: CapturedFrame[], fps: number): CapturedFrame[] {
  if (frames.length === 0) return [];
  const interval = 1000 / fps;
  const duration = frames[frames.length - 1]!.t;
  const out: CapturedFrame[] = [];
  let src = 0;
  for (let t = 0; t <= duration; t += interval) {
    while (src + 1 < frames.length && frames[src + 1]!.t <= t) src++;
    out.push({ data: frames[src]!.data, t });
  }
  return out;
}
