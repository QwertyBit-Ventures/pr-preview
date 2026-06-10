/**
 * Generate the README demo clip headlessly: drive the example todo app
 * through a short journey, then capture+encode it (with a burned-in caption)
 * to docs/media/demo.gif. Not part of the package — a maintenance script.
 *
 *   npx tsx scripts/gen-demo.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configSchema } from "../src/config/schema.js";
import { allocatePorts } from "../src/server/ports.js";
import { startDevServer } from "../src/server/devServer.js";
import { startHarnessServer } from "../src/server/harnessServer.js";
import { launchSession } from "../src/browser/launch.js";
import { Session } from "../src/session/session.js";
import { getAppFrame } from "../src/browser/frame.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = path.join(ROOT, "examples/vite-react-todo");

process.env.PR_PREVIEW_HEADLESS = "1";

const config = configSchema.parse({
  devCommand: "npm run dev",
  url: "http://localhost:{port}",
  format: "gif",
  gif: { width: 760, fps: 24, quality: "max" },
  replay: { speed: 1.2 },
});

const ports = await allocatePorts();
const appUrl = `http://localhost:${ports.beforeApp}`;
const origin = new URL(appUrl).origin;

const dev = await startDevServer({
  command: config.devCommand,
  cwd: EXAMPLE,
  port: ports.beforeApp,
  url: appUrl,
  readyTimeout: 60_000,
});
const harness = await startHarnessServer({ port: ports.harness, appUrl, mode: "record", viewport: config.viewport });
const session = new Session(harness.bus, config, "record", appUrl);
const browser = await launchSession({
  harnessUrl: harness.url,
  targetOrigins: [origin],
  appViewport: config.viewport,
  headerStrip: config.headerStrip,
  onRawEvent: session.handleRawEvent,
});
await browser.page.setViewportSize({ width: 1400, height: 820 });
session.attachPage(browser.page, appUrl);

async function userClick(selector: string): Promise<void> {
  const frame = await getAppFrame(browser.page, origin);
  await frame.locator(selector).waitFor({ state: "visible", timeout: 5_000 });
  const c = await frame.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const rect = (await browser.page.locator("#app-frame").boundingBox())!;
  const scale = rect.width / config.viewport.width;
  await browser.page.mouse.click(rect.x + c.x * scale, rect.y + c.y * scale);
}

// Live-record the journey (the footage IS the clip): log in, add two todos.
await getAppFrame(browser.page, origin).then((f) => f.locator('[data-testid="email"]').waitFor());
session.setPhase("recording");
await browser.page.waitForTimeout(1200);
await userClick('[data-testid="email"]');
await browser.page.keyboard.type("demo@example.com");
await userClick('[data-testid="password"]');
await browser.page.keyboard.type("demo");
await userClick('[data-testid="login-btn"]');
await getAppFrame(browser.page, origin).then((f) => f.locator('[data-testid="new-todo"]').waitFor());
await userClick('[data-testid="new-todo"]');
await browser.page.keyboard.type("Polish the onboarding flow");
await userClick('[data-testid="add-todo"]');
await userClick('[data-testid="new-todo"]');
await browser.page.keyboard.type("Ship pr-preview to npm");
await userClick('[data-testid="add-todo"]');
await browser.page.waitForTimeout(600);
session.setPhase("idle");

const out = path.join(ROOT, "docs/media/demo");
const result = await session.encodeClip("before", out, {
  branch: "feature/onboarding",
  baseBranch: "main",
  timestamp: "2026-06-08 10:30",
});
console.log("wrote", result.paths.join(", "), `(${result.frameCount} frames)`);

await browser.close();
await harness.close();
await dev.stop();
process.exit(0);
