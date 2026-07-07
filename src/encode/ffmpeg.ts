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

/**
 * Smooth MP4 from the raw, variable-rate captured frames. Each frame is held for
 * its real duration (concat demuxer), then ffmpeg's `minterpolate` synthesises
 * intermediate frames up to `outFps` — turning a low, choppy capture rate into
 * fluid motion. `mode`:
 *  - "blend": cross-dissolve (motion-blur); never warps text/geometry.
 *  - "mci": motion-compensated; sharper moving cursor, slight warp risk on text.
 */
export async function encodeMp4Interpolated(
  pngFrames: Buffer[],
  durationsSec: number[],
  outFps: number,
  mode: "blend" | "mci",
  outFile: string,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "pr-preview-frames-"));
  try {
    await Promise.all(
      pngFrames.map((buf, i) =>
        writeFile(path.join(dir, `frame${String(i).padStart(5, "0")}.png`), buf),
      ),
    );
    // concat demuxer with per-frame durations = real capture timing. The last
    // file is repeated because the demuxer ignores the final `duration` line.
    const lines: string[] = [];
    pngFrames.forEach((_, i) => {
      lines.push(`file 'frame${String(i).padStart(5, "0")}.png'`);
      lines.push(`duration ${Math.max(0.001, durationsSec[i] ?? 1 / outFps).toFixed(4)}`);
    });
    lines.push(`file 'frame${String(pngFrames.length - 1).padStart(5, "0")}.png'`);
    await writeFile(path.join(dir, "list.txt"), lines.join("\n") + "\n");

    await mkdir(path.dirname(outFile), { recursive: true });
    // scd=fdiff: skip interpolation across scene changes (big frame-to-frame
    // differences) — duplicate instead of morphing between unrelated states.
    // (The token is `fdiff`, not `fdi`; the latter is unparseable and makes the
    // whole minterpolate command fail, silently downgrading to a choppy hold.)
    const interp =
      mode === "mci"
        ? `minterpolate=fps=${outFps}:mi_mode=mci:me_mode=bidir:mc_mode=aobmc:vsbmc=1:scd=fdiff`
        : `minterpolate=fps=${outFps}:mi_mode=blend:scd=fdiff`;
    const common = ["-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outFile]; // prettier-ignore
    const input = ["-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt")];
    const scale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    try {
      await run("ffmpeg", ["-y", ...input, "-vf", `${interp},${scale}`, "-r", String(outFps), ...common]);
    } catch (err) {
      // minterpolate can be unavailable or choke on odd input — fall back to a
      // plain constant-fps encode at real timing. Still a valid clip, just not
      // interpolated, so a recording never fails for want of smoothing. Warn
      // loudly: a silent fallback here once hid a bad filter arg and shipped
      // choppy (un-interpolated) video as if it were smooth.
      console.warn(
        `[pr-preview] motion smoothing (${mode}) failed; encoding without interpolation — the clip will look choppier.\n  ${(err as Error).message?.split("\n")[0] ?? err}`,
      );
      await run("ffmpeg", ["-y", ...input, "-vf", scale, "-r", String(outFps), ...common]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
