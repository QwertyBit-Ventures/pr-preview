import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let available: boolean | null = null;

export function ffmpegAvailable(): Promise<boolean> {
  if (available !== null) return Promise.resolve(available);
  return new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], (err) => {
      available = !err;
      resolve(available);
    });
  });
}

/** Write frames into a temp dir, hand the pattern to fn, clean up after. */
async function withFrameDir<T>(
  pngFrames: Buffer[],
  fn: (pattern: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pr-preview-frames-"));
  try {
    await Promise.all(
      pngFrames.map((buf, i) =>
        writeFile(path.join(dir, `frame${String(i).padStart(5, "0")}.png`), buf),
      ),
    );
    return await fn(path.join(dir, "frame%05d.png"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Max-quality GIF via ffmpeg's two-pass palettegen/paletteuse with
 * Bayer dithering — noticeably better gradients than pure-JS quantization.
 */
export async function encodeWithFfmpeg(
  pngFrames: Buffer[],
  fps: number,
  outFile: string,
): Promise<void> {
  await withFrameDir(pngFrames, async (pattern) => {
    await mkdir(path.dirname(outFile), { recursive: true });
    const filter =
      `[0:v]fps=${fps},split[a][b];` +
      `[a]palettegen=stats_mode=diff[p];` +
      `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    await run("ffmpeg", ["-y", "-framerate", String(fps), "-i", pattern, "-filter_complex", filter, outFile]);
  });
}

/**
 * Small + HQ H.264 MP4 — uploads directly into a GitHub PR description.
 * yuv420p + faststart for universal playback; dimensions forced even
 * (H.264 requirement).
 */
export async function encodeMp4(
  pngFrames: Buffer[],
  fps: number,
  outFile: string,
): Promise<void> {
  await withFrameDir(pngFrames, async (pattern) => {
    await mkdir(path.dirname(outFile), { recursive: true });
    await run("ffmpeg", [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      pattern,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-movflags",
      "+faststart",
      outFile,
    ]);
  });
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => (err = (err + c.toString()).slice(-2000)));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code}):\n${err}`)),
    );
  });
}
