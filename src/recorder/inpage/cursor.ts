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

const CURSOR_SVG = `<svg width="100%" height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z" fill="#1a1a2e" stroke="#fff" stroke-width="1.5"/></svg>`;

function ease(t: number): number {
  // easeInOutCubic — gentle acceleration in/out for a natural glide.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOut(t: number): number {
  // easeOutCubic — quick departure, soft settle. Used for the small corrective
  // submovement so the cursor eases into its final resting spot.
  return 1 - Math.pow(1 - t, 3);
}

export function installCursor(): void {
  if (window.__prPreviewCursor) return;

  let el: HTMLDivElement | null = null;
  // Start at viewport center so the first glide reads naturally (not from the
  // top-left corner).
  let pos = { x: (window.innerWidth || 1280) / 2, y: (window.innerHeight || 800) / 2 };
  // Press scale — dips toward 0 on a click so the pointer "pushes" like a real
  // tap, then springs back. Applied together with the translate in place().
  let scale = 1;

  function ensure(): HTMLDivElement {
    if (el && document.body.contains(el)) return el;
    // The container is a ZERO-SIZE point anchored at the pointer hotspot; its
    // children (highlight halo + arrow) are positioned around that point, and the
    // whole thing is moved with transform:translate() and pressed with scale().
    //
    // left:0;top:0 is REQUIRED: without an inset, a position:fixed box takes its
    // *static* position as the translate origin. When the app centers its body
    // (flex/grid) that static spot is mid-screen, so the cursor renders offset by
    // half the viewport and drifts off the crop — i.e. "invisible". Anchoring to
    // (0,0) makes translate(x,y) mean exactly (x,y).
    el = document.createElement("div");
    el.id = "__pr-preview-cursor";
    el.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;" +
      "transform-origin:0 0;transition:none;will-change:transform;display:none;";

    // Always-on highlight: a soft accent "spotlight" centred on the hotspot so the
    // pointer — and its motion — is obvious even when the app is scaled down to a
    // small clip and the cursor is moving across empty space. Centred on (0,0).
    const halo = document.createElement("div");
    halo.style.cssText =
      "position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;" +
      "background:radial-gradient(circle,rgba(79,142,247,.45) 0%,rgba(79,142,247,.18) 42%,rgba(79,142,247,0) 70%);";

    // The arrow, ~40px so it reads at a normal on-screen size once the iframe is
    // scaled to fit the clip. Tip aligned to the container origin (the hotspot).
    const arrow = document.createElement("div");
    arrow.style.cssText =
      "position:absolute;left:-6px;top:-5px;width:40px;height:40px;" +
      "filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));";
    arrow.innerHTML = CURSOR_SVG;

    el.appendChild(halo);
    el.appendChild(arrow);
    document.body.appendChild(el);
    return el;
  }

  function apply(): void {
    const node = ensure();
    node.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`;
  }

  function place(x: number, y: number): void {
    pos = { x, y };
    apply();
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
        // Scale the glide time to the distance travelled. Capture now runs ~60fps
        // during motion, so we no longer pad the duration to avoid "teleporting" —
        // this is a natural pointer speed (~1px/ms), floored so short hops still
        // read as a deliberate move and capped at the caller's ceiling.
        const dx = x - from.x;
        const dy = y - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) {
          place(x, y);
          resolve();
          return;
        }
        const dur = Math.max(280, Math.min(durationMs, dist * 0.9));
        // Unit vectors: along the travel direction and perpendicular to it.
        const ux = dx / dist;
        const uy = dy / dist;
        const nx = -uy;
        const ny = ux;

        // Overshoot-and-correct: a real hand makes one fast ballistic movement
        // that sails a little PAST the target, then a quick corrective sub-
        // movement pulls back onto it (Fitts's law). Tiny hops land directly —
        // a visible correction on a short move looks fussy, not human.
        const overshoot = dist > 70 ? Math.min(dist * 0.08, 14) : 0;
        const aim = { x: x + ux * overshoot, y: y + uy * overshoot };
        const adx = aim.x - from.x;
        const ady = aim.y - from.y;

        // Follow a curved (quadratic-Bézier) path instead of a ruler-straight
        // line: a hand reaching for a target arcs. The control point sits at the
        // midpoint, pushed perpendicular to the travel direction; the arc scales
        // with distance (capped) and flips side at random for variety.
        const arc = Math.min(dist * 0.16, 55) * (Math.random() < 0.5 ? -1 : 1);
        const cx = from.x + adx * 0.5 + nx * arc;
        const cy = from.y + ady * 0.5 + ny * arc;
        // Sub-pixel tremor, fading to zero on approach so the cursor lands clean.
        const jitter = Math.min(dist * 0.02, 3.5);

        const ballisticDur = overshoot ? dur * 0.82 : dur;
        const correctDur = 150;

        // Phase 2: ease from the overshoot point back onto the exact target.
        const correct = (from2: { x: number; y: number }, c0: number) => {
          const t = Math.min(1, (performance.now() - c0) / correctDur);
          const k = easeOut(t);
          place(from2.x + (x - from2.x) * k, from2.y + (y - from2.y) * k);
          if (t < 1) requestAnimationFrame(() => correct(from2, c0));
          else {
            place(x, y);
            resolve();
          }
        };

        // Phase 1: the ballistic reach along the arc to the overshoot point.
        const t0 = performance.now();
        const ballistic = (now: number) => {
          const t = Math.min(1, (now - t0) / ballisticDur);
          const k = ease(t);
          const mt = 1 - k;
          let px = mt * mt * from.x + 2 * mt * k * cx + k * k * aim.x;
          let py = mt * mt * from.y + 2 * mt * k * cy + k * k * aim.y;
          if (t < 0.9) {
            const fade = 1 - t / 0.9;
            px += (Math.random() * 2 - 1) * jitter * fade;
            py += (Math.random() * 2 - 1) * jitter * fade;
          }
          place(px, py);
          if (t < 1) requestAnimationFrame(ballistic);
          else if (overshoot) correct({ x: aim.x, y: aim.y }, performance.now());
          else {
            place(x, y);
            resolve();
          }
        };
        requestAnimationFrame(ballistic);
      });
    },
    clickPulse() {
      return new Promise((resolve) => {
        const ring = document.createElement("div");
        ring.style.cssText =
          `position:fixed;z-index:2147483646;pointer-events:none;left:${pos.x - 22}px;top:${pos.y - 22}px;` +
          "width:44px;height:44px;border-radius:50%;border:3px solid #4f8ef7;opacity:.9;" +
          "transform:scale(.4);transition:transform .3s ease-out,opacity .3s ease-out;";
        document.body.appendChild(ring);
        // Press the pointer itself: a quick dip to 0.82 and spring back, so the
        // click reads as a physical tap, not just an expanding ring. Driven by
        // rAF (not CSS transition) because place() rewrites transform each frame.
        const pressT0 = performance.now();
        const PRESS_MS = 200;
        const press = (now: number) => {
          const p = Math.min(1, (now - pressT0) / PRESS_MS);
          // down-then-up: dips at the midpoint, back to 1 at the ends.
          scale = 1 - 0.18 * Math.sin(p * Math.PI);
          apply();
          if (p < 1) requestAnimationFrame(press);
          else {
            scale = 1;
            apply();
          }
        };
        requestAnimationFrame(press);
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
