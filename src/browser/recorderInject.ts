import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import type { RawEvent } from "../recorder/types.js";

export type RawEventHandler = (event: RawEvent) => void;

let recorderSource: string | null = null;

/** Load the built in-page recorder IIFE (dist/inpage/recorder.global.js). */
async function loadRecorderSource(): Promise<string> {
  if (recorderSource) return recorderSource;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../inpage/recorder.global.js"), // dist/cli → dist/inpage
    path.resolve(here, "../../dist/inpage/recorder.global.js"), // running from src (tests)
    path.resolve(here, "../../../dist/inpage/recorder.global.js"),
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(
      `In-page recorder bundle not found (looked in: ${candidates.join(", ")}). Run \`npm run build\` first.`,
    );
  }
  recorderSource = await readFile(found, "utf8");
  return recorderSource;
}

/**
 * The cross-origin trick that makes the whole architecture work:
 * exposeBinding is available in ALL frames (CDP-level), so the recorder
 * inside the cross-origin app iframe can call __prPreviewEmit and reach Node
 * — no proxy, no postMessage gymnastics.
 */
export async function installRecorderBinding(
  page: Page,
  targetOrigins: string[],
  onEvent: RawEventHandler,
): Promise<void> {
  await page.exposeBinding("__prPreviewEmit", (source, json: string) => {
    // Accept events only from the target app's frames.
    try {
      if (!targetOrigins.includes(new URL(source.frame.url()).origin)) return;
    } catch {
      return;
    }
    try {
      onEvent(JSON.parse(json) as RawEvent);
    } catch {
      /* malformed event — drop */
    }
  });

  // Runs in every frame (including ones created by future navigations/HMR
  // reloads); the script self-gates to iframes only.
  await page.addInitScript({ content: await loadRecorderSource() });
}
