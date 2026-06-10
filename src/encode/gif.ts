import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
// @ts-expect-error gifenc ships no types
import * as gifencNs from "gifenc";
// Dual-package interop: Node ESM sees CJS (functions hang off .default),
// bundler-resolved ESM has real named exports PLUS a default that is just
// the encoder — so pick whichever shape actually carries the API.
const gifencLib: any =
  typeof (gifencNs as any).quantize === "function" ? gifencNs : (gifencNs as any).default;
const { GIFEncoder, quantize, applyPalette } = gifencLib;
import type { CapturedFrame } from "../capture/screencast.js";
import { resampleToFps } from "../capture/frames.js";
import { cssRectToFramePixels } from "../capture/region.js";
import { encodeWithFfmpeg, ffmpegAvailable } from "./ffmpeg.js";
import { renderLabel, renderWatermark, type LabelSpec } from "./label.js";

export interface EncodeOptions {
  /** Iframe bounding box in CSS px (from getAppFrameRect). */
  cropCss: { x: number; y: number; width: number; height: number };
  /** Page viewport in CSS px (to derive the screencast pixel scale). */
  pageCssSize: { width: number; height: number };
  width: number;
  fps: number;
  quality: "high" | "max";
  maxColors: number;
  outFile: string;
  /** Burned-in branch/timestamp caption (omit videoWidth — set per output). */
  label?: Omit<LabelSpec, "videoWidth">;
  /** Encoding progress, for a UI bar. `stage` is a short human label. */
  onProgress?: (stage: string, done: number, total: number) => void;
}

export interface Overlay {
  input: Buffer;
  top: number;
  left: number;
}

/**
 * Build the burned-in overlays: the branch/timestamp caption (bottom-left)
 * and the pr-preview.com watermark (bottom-right). The watermark is always
 * present; the caption only when label info is provided.
 */
export async function buildOverlays(
  label: Omit<LabelSpec, "videoWidth"> | undefined,
  outWidth: number,
  outHeight: number,
): Promise<Overlay[]> {
  const inset = Math.round(outWidth * 0.018);
  const overlays: Overlay[] = [];

  if (label) {
    const png = await renderLabel({ ...label, videoWidth: outWidth });
    const m = await sharp(png).metadata();
    overlays.push({ input: png, top: outHeight - (m.height ?? 0) - inset, left: inset });
  }

  const wm = await renderWatermark(outWidth);
  const wmMeta = await sharp(wm).metadata();
  overlays.push({
    input: wm,
    top: outHeight - (wmMeta.height ?? 0) - inset,
    left: outWidth - (wmMeta.width ?? 0) - inset,
  });

  return overlays;
}

/**
 * frames (JPEG, full page) → crop to iframe → resize → global palette →
 * GIF. With quality:"max" and ffmpeg on PATH, defer to ffmpeg's
 * palettegen/paletteuse for the best dithering.
 */
export async function encodeGif(
  rawFrames: CapturedFrame[],
  opts: EncodeOptions,
): Promise<{ path: string; frameCount: number }> {
  if (rawFrames.length === 0) throw new Error("No frames captured — nothing to encode");

  const frames = resampleToFps(rawFrames, opts.fps);
  const meta = await sharp(frames[0]!.data).metadata();
  const crop = cssRectToFramePixels(
    opts.cropCss,
    { width: meta.width!, height: meta.height! },
    opts.pageCssSize,
  );

  const outWidth = Math.min(opts.width, crop.width);
  const outHeight = Math.round((crop.height / crop.width) * outWidth);
  const overlays = await buildOverlays(opts.label, outWidth, outHeight);

  // Decode each unique source buffer once (resampling repeats buffers).
  const rgbaCache = new Map<Buffer, Uint8ClampedArray>();
  const decode = async (jpeg: Buffer): Promise<Uint8ClampedArray> => {
    const hit = rgbaCache.get(jpeg);
    if (hit) return hit;
    let pipe = sharp(jpeg).extract(crop).resize(outWidth, outHeight);
    if (overlays.length) pipe = pipe.composite(overlays);
    const { data } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    rgbaCache.set(jpeg, rgba);
    return rgba;
  };

  if (opts.quality === "max" && (await ffmpegAvailable())) {
    const pngs: Buffer[] = [];
    for (const f of frames) {
      let pipe = sharp(f.data).extract(crop).resize(outWidth, outHeight);
      if (overlays.length) pipe = pipe.composite(overlays);
      pngs.push(await pipe.png().toBuffer());
      opts.onProgress?.("Rendering frames", pngs.length, frames.length);
    }
    opts.onProgress?.("Encoding GIF", frames.length, frames.length);
    await encodeWithFfmpeg(pngs, opts.fps, opts.outFile);
    return { path: opts.outFile, frameCount: frames.length };
  }

  // Global palette sampled across the run — less flicker than per-frame.
  const sampleCount = Math.min(10, frames.length);
  const sampleStride = Math.max(1, Math.floor(frames.length / sampleCount));
  const samples: Uint8ClampedArray[] = [];
  for (let i = 0; i < frames.length; i += sampleStride) {
    samples.push(await decode(frames[i]!.data));
  }
  const combined = new Uint8ClampedArray(samples.reduce((n, s) => n + s.length, 0));
  let offset = 0;
  for (const s of samples) {
    combined.set(s, offset);
    offset += s.length;
  }
  const palette = quantize(combined, opts.maxColors);

  const gif = GIFEncoder();
  const delay = 1000 / opts.fps;
  let first = true;
  let done = 0;
  for (const frame of frames) {
    const rgba = await decode(frame.data);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, outWidth, outHeight, {
      palette: first ? palette : undefined,
      first,
      delay,
      repeat: first ? 0 : undefined, // loop forever
    });
    first = false;
    opts.onProgress?.("Encoding GIF", ++done, frames.length);
  }
  gif.finish();

  await mkdir(path.dirname(opts.outFile), { recursive: true });
  await writeFile(opts.outFile, gif.bytes());
  return { path: opts.outFile, frameCount: frames.length };
}
