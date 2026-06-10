import type { Frame, Page } from "playwright";

const SCRIM_ID = "__pr-preview-scrim";

/**
 * A blocking overlay in the harness top frame, covering the app area while a
 * replay is being captured — so the user can't click into the iframe and
 * corrupt the recording. It's briefly made click-through around each
 * synthesized mouse click (see setClickThrough) so the replayer's own clicks
 * land, then re-armed.
 */
export async function showScrim(page: Page): Promise<void> {
  await page
    .evaluate((id) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.innerHTML =
          '<div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);' +
          "display:flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;" +
          "background:#1f2328;color:#fff;font:600 12.5px -apple-system,Segoe UI,sans-serif;" +
          'box-shadow:0 8px 24px rgba(0,0,0,.25)">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:#635bff;' +
          'animation:__prpulse 1.2s ease-in-out infinite"></span>' +
          "Simulating — please don’t click</div>";
        const style = document.createElement("style");
        style.textContent = "@keyframes __prpulse{50%{opacity:.3}}";
        el.appendChild(style);
        // Cover everything except the sidebar (right 340px) — the app + chrome.
        el.style.cssText =
          "position:fixed;top:0;left:0;right:340px;bottom:0;z-index:100;" +
          "cursor:not-allowed;background:rgba(20,22,26,0.04);";
        document.body.appendChild(el);
      }
      el.style.display = "block";
      el.style.pointerEvents = "auto";
    }, SCRIM_ID)
    .catch(() => {});
}

export async function hideScrim(page: Page): Promise<void> {
  await page
    .evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    }, SCRIM_ID)
    .catch(() => {});
}

export async function removeScrim(page: Page): Promise<void> {
  await page
    .evaluate((id) => document.getElementById(id)?.remove(), SCRIM_ID)
    .catch(() => {});
}

/** Let synthesized clicks pass through to the iframe for an instant. */
export async function setScrimClickThrough(page: Page, through: boolean): Promise<void> {
  await page
    .evaluate(
      ({ id, through }) => {
        const el = document.getElementById(id);
        if (el) el.style.pointerEvents = through ? "none" : "auto";
      },
      { id: SCRIM_ID, through },
    )
    .catch(() => {});
}

/**
 * Manual-input mode: dim the whole app inside the iframe and lift just the
 * target field above the dim, so the only thing the user can touch is that
 * field (plus the Continue button, which lives in the harness top frame).
 * Returns true if a field was spotlit.
 */
export async function spotlightInFrame(frame: Frame, selectors: string[]): Promise<boolean> {
  return frame
    .evaluate((selectors) => {
      let el: HTMLElement | null = null;
      for (const s of selectors) {
        try {
          const found = document.querySelector(s);
          if (found instanceof HTMLElement) {
            el = found;
            break;
          }
        } catch {
          /* non-CSS selector (e.g. Playwright text engine) — skip */
        }
      }
      if (!el) el = document.querySelector('input[type="password"]');
      if (!el) return false;

      el.scrollIntoView({ block: "center", inline: "center" });
      const dim = document.createElement("div");
      dim.id = "__pr-preview-dim";
      dim.style.cssText =
        "position:fixed;inset:0;z-index:2147482000;background:rgba(17,24,39,.55);" +
        "pointer-events:auto;cursor:not-allowed;";
      document.body.appendChild(dim);

      el.setAttribute("data-prp-prevstyle", el.getAttribute("style") ?? "\0");
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.style.zIndex = "2147482001";
      el.style.boxShadow = "0 0 0 3px #635bff, 0 10px 30px rgba(99,91,255,.45)";
      el.style.borderRadius = el.style.borderRadius || "8px";
      try {
        (el as HTMLInputElement).focus();
      } catch {
        /* not focusable */
      }
      return true;
    }, selectors)
    .catch(() => false);
}

export async function clearSpotlightInFrame(frame: Frame): Promise<void> {
  await frame
    .evaluate(() => {
      document.getElementById("__pr-preview-dim")?.remove();
      const el = document.querySelector("[data-prp-prevstyle]");
      if (el instanceof HTMLElement) {
        const prev = el.getAttribute("data-prp-prevstyle");
        if (prev && prev !== "\0") el.setAttribute("style", prev);
        else el.removeAttribute("style");
        el.removeAttribute("data-prp-prevstyle");
      }
    })
    .catch(() => {});
}
