import type { Frame, Page } from "playwright";

/**
 * Resolve the target app's Frame inside the harness page. Frames are
 * recreated on full reloads (HMR, navigation) so always re-resolve rather
 * than caching the handle.
 */
export async function getAppFrame(
  page: Page,
  targetOrigin: string,
  timeoutMs = 15_000,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => {
      try {
        return new URL(f.url()).origin === targetOrigin;
      } catch {
        return false;
      }
    });
    if (frame && !frame.isDetached()) return frame;
    await page.waitForTimeout(200);
  }
  throw new Error(`App iframe (${targetOrigin}) did not appear within ${timeoutMs}ms`);
}

/** Bounding box of the iframe element in page coordinates (CSS px). */
export async function getAppFrameRect(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator("#app-frame").boundingBox();
  if (!box) throw new Error("App iframe element (#app-frame) not found in harness page");
  return box;
}
