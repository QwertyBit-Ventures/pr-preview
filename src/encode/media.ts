import sharp from "sharp";
import type { CapturedFrame } from "../capture/screencast.js";
import { resampleToFps } from "../capture/frames.js";
import { cssRectToFramePixels } from "../capture/region.js";
import { buildOverlays, encodeGif, type EncodeOptions } from "./gif.js";
import { encodeMp4, encodeMp4Interpolated, ffmpegAvailable } from "./ffmpeg.js";

export type MediaFormat = "mp4" | "gif" | "both";

export interface MediaResult {
  /** Produced files (mp4 first when both). */
  paths: string[];
  frameCount: number;
  /** Set when mp4 was requested but ffmpeg is missing. */
  fellBackToGif: boolean;
}

/**
 * Encode captured frames into the configured format(s).
 * `outBase` is the extension-less output path (e.g. ".pr-preview/output/before").
 */
export async function encodeMedia(
  rawFrames: CapturedFrame[],
  opts: Omit<EncodeOptions, "outFile"> & { format: MediaFormat; outBase: string },
): Promise<MediaResult> {
  if (rawFrames.length === 0) throw new Error("No frames captured — nothing to encode");

  const wantsMp4 = opts.format === "mp4" || opts.format === "both";
  const haveFfmpeg = await ffmpegAvailable();
  const doMp4 = wantsMp4 && haveFfmpeg;
  const doGif = opts.format === "gif" || opts.format === "both" || (wantsMp4 && !haveFfmpeg);

  const paths: string[] = [];
  let frameCount = 0;

  if (doMp4) {
    const interpolate = opts.interpolate ?? "off";
    const smooth = interpolate !== "off";
    // With interpolation we feed the RAW, distinct captured frames (real timing)
    // so ffmpeg can synthesise smooth in-between motion. Without it, keep the
    // old constant-fps sample-and-hold.
    const frames = smooth ? rawFrames : resampleToFps(rawFrames, opts.fps);
    frameCount = frames.length;

    const meta = await sharp(frames[0]!.data).metadata();
    const crop = cssRectToFramePixels(
      opts.cropCss,
      { width: meta.width!, height: meta.height! },
      opts.pageCssSize,
    );
    // MP4 keeps full capture resolution up to 2x the configured width —
    // video compresses well, and PR viewers can fullscreen it.
    const outWidth = Math.min(opts.width * 2, crop.width);
    const outHeight = Math.round((crop.height / crop.width) * outWidth);
    const overlays = await buildOverlays(opts.label, outWidth, outHeight);

    const pngs: Buffer[] = [];
    const cache = new Map<Buffer, Buffer>();
    for (const f of frames) {
      let png = cache.get(f.data);
      if (!png) {
        let pipe = sharp(f.data).extract(crop).resize(outWidth, outHeight);
        if (overlays.length) pipe = pipe.composite(overlays);
        png = await pipe.png().toBuffer();
        cache.set(f.data, png);
      }
      pngs.push(png);
      opts.onProgress?.("Rendering frames", pngs.length, frames.length);
    }
    const file = `${opts.outBase}.mp4`;
    opts.onProgress?.("Encoding MP4", frames.length, frames.length);
    if (smooth) {
      // Per-frame duration = real gap to the next captured frame (seconds),
      // CAPPED so a long idle gap (e.g. the agent's thinking time between
      // actions, when nothing repaints) isn't turned into a slow morph by the
      // interpolator — it's held briefly instead, which also trims dead air.
      const MAX_HOLD = 0.5;
      const durations = frames.map((f, i) =>
        i < frames.length - 1
          ? Math.min(MAX_HOLD, Math.max(0.001, (frames[i + 1]!.t - f.t) / 1000))
          : 1 / opts.fps,
      );
      const outFps = Math.max(opts.smoothFps ?? 30, opts.fps);
      await encodeMp4Interpolated(pngs, durations, outFps, interpolate as "blend" | "mci", file);
    } else {
      await encodeMp4(pngs, opts.fps, file);
    }
    paths.push(file);
  }

  if (doGif) {
    const result = await encodeGif(rawFrames, { ...opts, outFile: `${opts.outBase}.gif` });
    paths.push(result.path);
    frameCount = result.frameCount;
  }

  return { paths, frameCount, fellBackToGif: wantsMp4 && !haveFfmpeg };
}
