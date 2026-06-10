/**
 * Synthetic cursor overlay — lives inside the target iframe so the GIF shows
 * mouse movement. Driven by the Node replayer via frame.evaluate calls on
 * window.__prPreviewCursor.
 */

declare global {
  interface Window {
    __prPreviewCursor?: CursorApi;
  }
}

export interface CursorApi {
  show(x: number, y: number): void;
  moveTo(x: number, y: number, durationMs: number): Promise<void>;
  clickPulse(): Promise<void>;
  hide(): void;
}

const CURSOR_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z" fill="#1a1a2e" stroke="#fff" stroke-width="1.5"/></svg>`;

function ease(t: number): number {
  // easeInOutCubic — gentle acceleration in/out for a natural glide.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function installCursor(): void {
  if (window.__prPreviewCursor) return;

  let el: HTMLDivElement | null = null;
  // Start at viewport center so the first glide reads naturally (not from the
  // top-left corner).
  let pos = { x: (window.innerWidth || 1280) / 2, y: (window.innerHeight || 800) / 2 };

  function ensure(): HTMLDivElement {
    if (el && document.body.contains(el)) return el;
    el = document.createElement("div");
    el.id = "__pr-preview-cursor";
    el.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;width:24px;height:24px;" +
      "transition:none;will-change:transform;display:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));";
    el.innerHTML = CURSOR_SVG;
    document.body.appendChild(el);
    return el;
  }

  function place(x: number, y: number): void {
    pos = { x, y };
    const node = ensure();
    node.style.transform = `translate(${x}px, ${y}px)`;
  }

  window.__prPreviewCursor = {
    show(x, y) {
      const node = ensure();
      place(x, y);
      node.style.display = "block";
    },
    moveTo(x, y, durationMs) {
      return new Promise((resolve) => {
        const node = ensure();
        node.style.display = "block";
        const from = { ...pos };
        // Scale the glide time to the distance travelled (with floor/cap) so
        // short hops are quick and long sweeps stay smooth, never abrupt.
        const dist = Math.hypot(x - from.x, y - from.y);
        const dur = Math.max(140, Math.min(durationMs, dist * 0.7));
        if (dist < 1) {
          resolve();
          return;
        }
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          const k = ease(t);
          place(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    },
    clickPulse() {
      return new Promise((resolve) => {
        const ring = document.createElement("div");
        ring.style.cssText =
          `position:fixed;z-index:2147483646;pointer-events:none;left:${pos.x - 14}px;top:${pos.y - 14}px;` +
          "width:28px;height:28px;border-radius:50%;border:3px solid #4f8ef7;opacity:.9;" +
          "transform:scale(.4);transition:transform .3s ease-out,opacity .3s ease-out;";
        document.body.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = "scale(1.4)";
          ring.style.opacity = "0";
        });
        setTimeout(() => {
          ring.remove();
          resolve();
        }, 320);
      });
    },
    hide() {
      if (el) el.style.display = "none";
    },
  };
}
