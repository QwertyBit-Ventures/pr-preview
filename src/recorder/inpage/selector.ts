/**
 * Selector chain builder — runs INSIDE the target iframe (browser context).
 * Returns selectors ordered best→worst; every entry must resolve uniquely
 * in the current document at build time.
 */

const TESTID_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa"];

/** Heuristic: ids that look machine-generated are useless across reloads. */
function looksGenerated(id: string): boolean {
  if (/^[«:]/.test(id)) return true; // React useId (:r1:, «r1»)
  if (/\d{4,}/.test(id)) return true;
  if (/[0-9a-f]{6,}/i.test(id)) return true;
  if (/^(radix|headlessui|mui|aria)-/i.test(id)) return true;
  return false;
}

function cssEscape(value: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

/** True when a string is an example value (numbers/currency/date), not a label. */
function looksLikeExampleValue(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  // Entirely digits/decimals/currency/percent/date separators → an example value.
  return /^[\d.,:%$£€/\\\s+-]+$/.test(t);
}

function isUnique(selector: string, el: Element): boolean {
  try {
    // Query within the element's own root (a ShadowRoot or the document), so
    // selectors for elements inside open web components resolve. Playwright's
    // CSS engine pierces open shadow roots, so the attribute/id selectors we
    // build still locate them at replay.
    const root = el.getRootNode() as Document | ShadowRoot;
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

/** Structural CSS path with :nth-of-type — the last resort. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    if (parent && isUnique(parts.join(" > "), el)) break;
    node = parent;
  }
  return parts.join(" > ");
}

/**
 * Build the fallback chain for an element. The clickable ancestor is usually
 * more stable than the exact node (e.g. an <svg> inside a <button>).
 */
export function buildSelectors(target: Element): string[] {
  const el = closestInteractive(target) ?? target;
  const out: string[] = [];
  const push = (sel: string) => {
    if (sel && !out.includes(sel) && isUnique(sel, el)) out.push(sel);
  };

  for (const attr of TESTID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) push(`[${attr}="${cssEscape(v)}"]`);
  }

  if (el.id && !looksGenerated(el.id)) push(`#${cssEscape(el.id)}`);

  const name = el.getAttribute("name");
  if (name) push(`${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`);

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) push(`[aria-label="${cssEscape(ariaLabel)}"]`);

  // Use the placeholder only when it's a descriptive label ("Email", "Search").
  // Value-like placeholders ("4.5", "0.00", "12/31") are example defaults that
  // change between builds — a fragile, misleading selector.
  const placeholder = el.getAttribute("placeholder");
  if (placeholder && !looksLikeExampleValue(placeholder)) {
    push(`[placeholder="${cssEscape(placeholder)}"]`);
  }

  // Playwright text engine for short, unique button/link text
  const text = (el.textContent ?? "").trim();
  if (
    text.length > 0 &&
    text.length <= 40 &&
    !text.includes('"') &&
    ["a", "button", "summary", "label"].includes(el.tagName.toLowerCase())
  ) {
    const sel = `${el.tagName.toLowerCase()}:has-text("${text}")`;
    // has-text is Playwright-only; uniqueness approximated via exact text match
    const root = el.getRootNode() as Document | ShadowRoot;
    const sameText = Array.from(root.querySelectorAll(el.tagName)).filter(
      (e) => (e.textContent ?? "").trim() === text,
    );
    if (sameText.length === 1 && !out.includes(sel)) out.push(sel);
  }

  // A structural CSS path is only valid in the light DOM. For an element
  // inside a shadow root the path is relative to that root, but at replay
  // Playwright applies CSS in the light DOM — where it can match a totally
  // different, similarly-shaped element. So skip it for shadow elements and
  // rely on the attribute/text selectors (which Playwright pierces into
  // shadow). If none of those existed we fall back to coordinates.
  const inShadow = el.getRootNode() instanceof ShadowRoot;
  if (!inShadow) {
    const path = cssPath(el);
    if (path && isUnique(path, el)) push(path);
    // Always have at least the structural path, even if non-unique checks failed
    if (out.length === 0 && path) out.push(path);
  }
  return out;
}

/** Walk up to the nearest interactive element (button, link, input, etc). */
export function closestInteractive(el: Element): Element | null {
  return el.closest(
    'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], label, [onclick], [tabindex]',
  );
}
