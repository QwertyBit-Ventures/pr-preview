import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadJourney, saveJourney } from "../../src/recorder/journey.js";
import type { Journey } from "../../src/recorder/types.js";

const journey: Journey = {
  version: 1,
  createdAt: "2026-06-07T00:00:00.000Z",
  viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
  startUrl: "/",
  steps: [
    {
      id: "stp_01",
      type: "fill",
      selectors: ['[data-testid="email"]'],
      value: "demo@example.com",
      timestamp: 100,
      thumbnail: "data:image/png;base64,xxx",
    },
    {
      id: "stp_02",
      type: "click",
      selectors: ['[data-testid="login-btn"]'],
      coordinates: { xNorm: 0.5, yNorm: 0.6 },
      causesNavigation: true,
      timestamp: 900,
    },
  ],
};

describe("journey persistence", () => {
  it("round-trips the journey, stripping sidebar thumbnails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pr-preview-test-"));
    const file = path.join(dir, "journey.json");
    try {
      await saveJourney(file, journey);

      const onDisk = await readFile(file, "utf8");
      expect(onDisk).not.toContain("base64");

      const loaded = await loadJourney(file);
      expect(loaded.steps).toHaveLength(2);
      expect(loaded.steps[0]).toMatchObject({ type: "fill", value: "demo@example.com" });
      expect(loaded.steps[1]).toMatchObject({ type: "click", causesNavigation: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed journey files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pr-preview-test-"));
    const file = path.join(dir, "bad.json");
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(file, JSON.stringify({ version: 2, steps: "nope" }));
      await expect(loadJourney(file)).rejects.toThrow(/Invalid journey/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
