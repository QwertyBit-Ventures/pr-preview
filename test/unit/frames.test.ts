import { describe, it, expect } from "vitest";
import { resampleToFps } from "../../src/capture/frames.js";
import { cssRectToFramePixels } from "../../src/capture/region.js";

describe("resampleToFps", () => {
  const frame = (t: number) => ({ data: Buffer.from([t]), t });

  it("produces a fixed-interval timeline from jittery input", () => {
    const frames = [frame(0), frame(35), frame(70), frame(220), frame(400)];
    const out = resampleToFps(frames, 10); // 100ms interval
    expect(out.map((f) => f.t)).toEqual([0, 100, 200, 300, 400]);
    // at t=100 the nearest preceding frame is t=70
    expect(out[1]!.data).toBe(frames[2]!.data);
    // at t=300 still showing the t=220 frame
    expect(out[3]!.data).toBe(frames[3]!.data);
  });

  it("reuses buffers by reference for dedupe downstream", () => {
    const frames = [frame(0), frame(900)];
    const out = resampleToFps(frames, 10);
    expect(out.length).toBe(10);
    for (let i = 0; i < 9; i++) expect(out[i]!.data).toBe(frames[0]!.data);
  });

  it("handles empty input", () => {
    expect(resampleToFps([], 10)).toEqual([]);
  });
});

describe("cssRectToFramePixels", () => {
  it("scales CSS coordinates to device-pixel frames (dsf 2)", () => {
    const crop = cssRectToFramePixels(
      { x: 0, y: 44, width: 1280, height: 800 },
      { width: 3200, height: 1688 }, // (1280+320, 800+44) * 2
      { width: 1600, height: 844 },
    );
    expect(crop).toEqual({ left: 0, top: 88, width: 2560, height: 1600 });
  });

  it("clamps to frame bounds", () => {
    const crop = cssRectToFramePixels(
      { x: 90, y: 0, width: 100, height: 100 },
      { width: 150, height: 80 },
      { width: 150, height: 80 },
    );
    expect(crop.left + crop.width).toBeLessThanOrEqual(150);
    expect(crop.top + crop.height).toBeLessThanOrEqual(80);
  });
});
