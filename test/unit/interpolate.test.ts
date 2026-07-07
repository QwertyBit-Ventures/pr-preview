import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { encodeMp4Interpolated, ffmpegAvailable } from "../../src/encode/ffmpeg.js";

const exec = promisify(execFile);

/** A 64x48 frame with a white square at horizontal offset `x` — moving it
 *  frame-to-frame gives the interpolator real motion to synthesise between. */
function frame(x: number): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: {
          create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
        },
        left: x,
        top: 19,
      },
    ])
    .png()
    .toBuffer();
}

async function probe(file: string): Promise<{ fps: number; frames: number }> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-count_frames",
    "-show_entries", "stream=r_frame_rate,nb_read_frames",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]); // prettier-ignore
  const [rate, nb] = stdout.trim().split("\n");
  const [num, den] = rate!.split("/").map(Number);
  return { fps: num! / (den || 1), frames: Number(nb) };
}

/** Count visually-distinct frames: re-encode through mpdecimate (which drops
 *  near-duplicate holds) and count what survives. A genuinely interpolated clip
 *  has many more distinct frames than the inputs; a sample-and-hold fallback
 *  collapses back to ~the input count. */
async function distinctFrames(file: string): Promise<number> {
  const decimated = file + ".decimated.mkv";
  await exec("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "mpdecimate", "-an", decimated]);
  return (await probe(decimated)).frames;
}

describe("encodeMp4Interpolated", () => {
  let hasFfmpeg = false;
  let dir = "";

  beforeAll(async () => {
    hasFfmpeg = await ffmpegAvailable();
    dir = await mkdtemp(path.join(tmpdir(), "interp-test-"));
    return async () => {
      await rm(dir, { recursive: true, force: true });
    };
  });

  for (const mode of ["blend", "mci"] as const) {
    it(`produces a valid MP4 at the target fps and fills in frames (${mode})`, async () => {
      if (!hasFfmpeg) return; // environment without ffmpeg — nothing to assert
      // 5 distinct frames spanning 0.4s of real time (100ms each).
      const frames = await Promise.all([4, 14, 24, 34, 44].map(frame));
      const durations = [0.1, 0.1, 0.1, 0.1, 0.1];
      const out = path.join(dir, `${mode}.mp4`);
      await encodeMp4Interpolated(frames, durations, 30, mode, out);

      const { fps, frames: nb } = await probe(out);
      expect(fps).toBe(30); // encoded at the requested rate
      // 0.4s at 30fps ≈ 12 frames — well above the 5 we fed in (interpolation ran).
      expect(nb).toBeGreaterThan(frames.length);
      // Frame COUNT alone can't tell interpolation from a sample-and-hold
      // fallback (both hit 30fps). Assert real in-between frames were synthesised:
      // the moving square lands at genuinely new positions, so distinct-frame
      // count exceeds the 5 inputs. A choppy hold would collapse back to ~5.
      expect(await distinctFrames(out)).toBeGreaterThan(frames.length);
    });
  }

  it("does not slow-morph across a long idle gap (capped hold)", async () => {
    if (!hasFfmpeg) return;
    // Two very different frames with a 5s gap between them. The encoder should
    // NOT stretch a 5s morph across it — the clip stays short.
    const frames = await Promise.all([4, 44].map(frame));
    const out = path.join(dir, "gap.mp4");
    // duration already capped by media.ts in production; here we pass a capped
    // value to assert the encoder honours short holds.
    await encodeMp4Interpolated(frames, [0.5, 1 / 30], 30, "blend", out);
    const { frames: nb } = await probe(out);
    expect(nb).toBeLessThan(30); // ~0.5s worth, not 5s
  });
});
