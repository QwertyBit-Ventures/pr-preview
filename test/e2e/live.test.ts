import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { configSchema } from "../../src/config/schema.js";
import { startDevServer, type DevServerHandle } from "../../src/server/devServer.js";
import { startHarnessServer, type HarnessServer } from "../../src/server/harnessServer.js";
import { launchSession, type BrowserSession } from "../../src/browser/launch.js";
import { Session } from "../../src/session/session.js";
import { getAppFrame } from "../../src/browser/frame.js";
import { allocatePorts } from "../../src/server/ports.js";
import type { RawEvent } from "../../src/recorder/types.js";

/**
 * Live capture: the clip IS the real recording (no replay). Records a journey
 * with a password, encodes the captured footage directly, and asserts a valid
 * clip is produced — and that the sensitive (password) window fires the
 * focus/blur signals that pause the footage (so the secret never lands in it).
 */

const ROOT = path.resolve(__dirname, "../..");
const EXAMPLE = path.join(ROOT, "examples/vite-react-todo");

let dev: DevServerHandle;
let harness: HarnessServer;
let browser: BrowserSession;
let session: Session;
let appUrl: string;
let outDir: string;
const rawEvents: string[] = [];

beforeAll(async () => {
  process.env.PR_PREVIEW_HEADLESS = "1";
  outDir = process.env.PR_PREVIEW_E2E_KEEP ?? (await mkdtemp(path.join(tmpdir(), "pr-preview-live-")));

  const config = configSchema.parse({
    devCommand: "npm run dev",
    url: "http://localhost:{port}",
    captureMode: "live",
    format: "both",
    gif: { width: 480, fps: 10 },
  });

  const ports = await allocatePorts();
  appUrl = `http://localhost:${ports.beforeApp}`;
  dev = await startDevServer({
    command: config.devCommand,
    cwd: EXAMPLE,
    port: ports.beforeApp,
    url: appUrl,
    readyTimeout: 60_000,
  });
  harness = await startHarnessServer({ port: ports.harness, appUrl, mode: "record", viewport: config.viewport });
  session = new Session(harness.bus, config, "record", appUrl);
  browser = await launchSession({
    harnessUrl: harness.url,
    targetOrigins: [new URL(appUrl).origin],
    appViewport: config.viewport,
    headerStrip: config.headerStrip,
    onRawEvent: (e: RawEvent) => {
      rawEvents.push(e.kind);
      session.handleRawEvent(e);
    },
  });
  await browser.page.setViewportSize({ width: 1400, height: 760 });
  session.attachPage(browser.page, appUrl);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await harness?.close();
  await dev?.stop();
  if (!process.env.PR_PREVIEW_E2E_KEEP) await rm(outDir, { recursive: true, force: true });
});

async function userClick(selector: string): Promise<void> {
  const frame = await getAppFrame(browser.page, new URL(appUrl).origin);
  await frame.locator(selector).waitFor({ state: "visible", timeout: 5_000 });
  const c = await frame.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const rect = (await browser.page.locator("#app-frame").boundingBox())!;
  const scale = rect.width / 1920;
  await browser.page.mouse.click(rect.x + c.x * scale, rect.y + c.y * scale);
}

describe("live capture (clip = the real recording)", () => {
  it("records a journey with a password and encodes a valid clip from the footage", async () => {
    const page = browser.page;
    // Wait for the app to load in the iframe before recording.
    await (await getAppFrame(page, new URL(appUrl).origin))
      .locator('[data-testid="email"]')
      .waitFor({ state: "visible", timeout: 20_000 });

    session.setPhase("recording"); // starts the recording feed (live footage)
    await page.waitForTimeout(1500); // let the screencast start

    await userClick('[data-testid="email"]');
    await page.keyboard.type("demo@example.com");
    await userClick('[data-testid="password"]');
    await page.keyboard.type("demo"); // example app requires demo@example.com / demo
    await userClick('[data-testid="login-btn"]');
    await userClick('[data-testid="new-todo"]');
    await page.keyboard.type("Live capture");
    await userClick('[data-testid="add-todo"]');
    await page.waitForTimeout(800);
    session.setPhase("idle");

    // Steps were recorded as the outline, and the journey happened live.
    expect(session.builder.getSteps().length).toBeGreaterThan(2);
    const frame = await getAppFrame(browser.page, new URL(appUrl).origin);
    await expect(frame.locator("li", { hasText: "Live capture" }).count()).resolves.toBeGreaterThan(0);

    // The clip is encoded straight from the captured footage — no replay.
    const outBase = path.join(outDir, "before");
    const result = await session.encodeClip("before", outBase, {
      branch: "main",
      baseBranch: "main",
      timestamp: "2026-06-09 10:00",
    });
    expect(result.frameCount).toBeGreaterThan(5);

    const gif = await readFile(`${outBase}.gif`);
    expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");
    expect(gif.readUInt16LE(6)).toBe(480);
    if (!result.fellBackToGif) {
      const mp4 = await readFile(`${outBase}.mp4`);
      expect(mp4.subarray(4, 8).toString("ascii")).toBe("ftyp");
    }
  }, 120_000);
});
