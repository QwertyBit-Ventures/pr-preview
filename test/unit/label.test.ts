import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderLabel } from "../../src/encode/label.js";

describe("renderLabel", () => {
  it("renders a non-empty PNG caption for the BEFORE pass", async () => {
    const png = await renderLabel({
      pass: "before",
      branch: "main",
      baseBranch: "main",
      timestamp: "2026-06-08 10:21",
      videoWidth: 1800,
    });
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const m = await sharp(png).metadata();
    expect(m.width).toBeGreaterThan(200);
    expect(m.height).toBeGreaterThan(20);
    expect(m.channels).toBe(4); // has alpha for compositing
  });

  it("scales the caption with the video width", async () => {
    const spec = {
      pass: "after" as const,
      branch: "feature/x",
      baseBranch: "main",
      timestamp: "2026-06-08 10:21",
    };
    const small = await sharp(await renderLabel({ ...spec, videoWidth: 600 })).metadata();
    const big = await sharp(await renderLabel({ ...spec, videoWidth: 1800 })).metadata();
    expect(big.height!).toBeGreaterThan(small.height!);
  });

  it("escapes markup-significant characters in branch names", async () => {
    // A branch with < & " must not break the Pango markup render.
    const png = await renderLabel({
      pass: "after",
      branch: 'fix/<a>&"b"',
      baseBranch: "main",
      timestamp: "2026-06-08 10:21",
      videoWidth: 1200,
    });
    expect((await sharp(png).metadata()).width).toBeGreaterThan(100);
  });
});
