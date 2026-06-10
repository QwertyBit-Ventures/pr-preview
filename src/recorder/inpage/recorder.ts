/**
 * In-page recorder — injected into every frame via addInitScript, but only
 * activates inside the target app iframe (never the harness top frame).
 *
 * Captures user interactions and ships them to the Node process through the
 * exposed binding `__prPreviewEmit`. Node decides what to do with them
 * (recording, ignoring during replay, watching during manual pauses).
 */

import { buildSelectors, closestInteractive } from "./selector.js";
import type { RawEvent } from "../types.js";

declare global {
  interface Window {
    __prPreviewEmit?: (json: string) => Promise<unknown>;
    __prPreviewRecorderInstalled?: boolean;
    /** Set by the tool while live-capturing — the synthetic cursor then follows
     *  the real mouse so it appears in the screencast (which omits the OS one).*/
    __prPreviewRecording?: boolean;
    // __prPreviewCursor is declared in cursor.ts (shared global).
  }
}

const SCROLL_IDLE_MS = 250;
const start = Date.now();

function emit(event: RawEvent): void {
  try {
    void window.__prPreviewEmit?.(JSON.stringify(event));
  } catch {
    /* binding not ready yet */
  }
}

function frameUrl(): string {
  return location.pathname + location.search + location.hash;
}

function norm(x: number, max: number): number {
  return max > 0 ? Math.min(1, Math.max(0, x / max)) : 0;
}

/** The real innermost target, piercing (open) shadow boundaries. */
function realTarget(e: Event): Element | null {
  const path = e.composedPath?.();
  const first = path && path[0];
  if (first instanceof Element) return first;
  return e.target instanceof Element ? e.target : null;
}

export function installRecorder(): void {
  if (window.__prPreviewRecorderInstalled) return;
  window.__prPreviewRecorderInstalled = true;

  // ---- clicks --------------------------------------------------------------
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted) return; // ignore replayer-synthesized events
      // A click with detail===0 isn't a pointer click — it's a keyboard or
      // implicit form-submit activation (e.g. pressing Enter in a field fires
      // a synthetic click on the submit button). The Enter keydown already
      // captures that intent, so recording this click would double it up and
      // break replay (it'd click a button that navigation has removed).
      if (e.detail === 0) return;
      const target = realTarget(e);
      if (!target) return;
      // Live capture: pulse the synthetic cursor so the click reads in the clip.
      if (window.__prPreviewRecording) window.__prPreviewCursor?.clickPulse();
      const el = closestInteractive(target) ?? target;
      emit({
        kind: "click",
        selectors: buildSelectors(target),
        xNorm: norm(e.clientX, window.innerWidth),
        yNorm: norm(e.clientY, window.innerHeight),
        text: (el.textContent ?? "").trim().slice(0, 40) || undefined,
        frameUrl: frameUrl(),
        ts: Date.now() - start,
      });
    },
    { capture: true },
  );

  // ---- synthetic cursor follows the real mouse while live-capturing --------
  // (the CDP screencast doesn't include the OS pointer, so we draw our own).
  let mouseRaf = 0;
  let lastX = 0;
  let lastY = 0;
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!e.isTrusted || !window.__prPreviewRecording) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (mouseRaf) return;
      mouseRaf = requestAnimationFrame(() => {
        mouseRaf = 0;
        window.__prPreviewCursor?.show(lastX, lastY);
      });
    },
    { capture: true, passive: true },
  );

  // ---- text input ----------------------------------------------------------
  document.addEventListener(
    "input",
    (e) => {
      if (!e.isTrusted) return;
      const el = realTarget(e) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el || !("value" in el)) return;
      if (el.tagName === "SELECT") return; // handled by the change listener below
      const type = (el as HTMLInputElement).type ?? "";
      if (["checkbox", "radio", "file", "range", "color"].includes(type)) return; // click covers these
      const rect = el.getBoundingClientRect();
      emit({
        kind: "input",
        selectors: buildSelectors(el),
        value: el.value,
        xNorm: norm(rect.x + rect.width / 2, window.innerWidth),
        yNorm: norm(rect.y + rect.height / 2, window.innerHeight),
        frameUrl: frameUrl(),
        ts: Date.now() - start,
      });
    },
    { capture: true },
  );

  // ---- native <select> -----------------------------------------------------
  document.addEventListener(
    "change",
    (e) => {
      if (!e.isTrusted) return;
      const el = realTarget(e);
      if (!(el instanceof HTMLSelectElement)) return; // checkboxes etc. via click
      const rect = el.getBoundingClientRect();
      emit({
        kind: "select",
        selectors: buildSelectors(el),
        value: el.value,
        xNorm: norm(rect.x + rect.width / 2, window.innerWidth),
        yNorm: norm(rect.y + rect.height / 2, window.innerHeight),
        frameUrl: frameUrl(),
        ts: Date.now() - start,
      });
    },
    { capture: true },
  );

  // ---- meaningful keys -----------------------------------------------------
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.isTrusted) return;
      if (!["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      const target = realTarget(e);
      emit({
        kind: "key",
        key: e.key,
        selectors: target ? buildSelectors(target) : [],
        frameUrl: frameUrl(),
        ts: Date.now() - start,
      });
    },
    { capture: true },
  );

  // ---- scroll (debounced to final position) --------------------------------
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let lastScrollTarget: Element | "window" = "window";
  document.addEventListener(
    "scroll",
    (e) => {
      if (!e.isTrusted) return;
      const t = e.target;
      lastScrollTarget =
        t === document || t === document.documentElement || t === window
          ? "window"
          : (t as Element);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (lastScrollTarget === "window") {
          const doc = document.documentElement;
          emit({
            kind: "scroll",
            target: "window",
            xNorm: norm(window.scrollX, doc.scrollWidth - window.innerWidth),
            yNorm: norm(window.scrollY, doc.scrollHeight - window.innerHeight),
            frameUrl: frameUrl(),
            ts: Date.now() - start,
          });
        } else {
          const el = lastScrollTarget;
          emit({
            kind: "scroll",
            target: buildSelectors(el)[0] ?? "window",
            xNorm: norm(el.scrollLeft, el.scrollWidth - el.clientWidth),
            yNorm: norm(el.scrollTop, el.scrollHeight - el.clientHeight),
            frameUrl: frameUrl(),
            ts: Date.now() - start,
          });
        }
      }, SCROLL_IDLE_MS);
    },
    { capture: true, passive: true },
  );

  // ---- SPA navigation (pushState / replaceState / popstate) -----------------
  const fireNavigate = () =>
    emit({ kind: "navigate", url: frameUrl(), frameUrl: frameUrl(), ts: Date.now() - start });
  const wrap = (method: "pushState" | "replaceState") => {
    const original = history[method].bind(history);
    history[method] = ((...args: Parameters<History["pushState"]>) => {
      const result = original(...args);
      fireNavigate();
      return result;
    }) as History["pushState"];
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", fireNavigate);
}
