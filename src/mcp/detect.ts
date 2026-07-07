/** Detect apps already running on the local machine, so an agent can offer the
 *  user a URL to record instead of guessing or silently starting a dev server. */

export interface LocalApp {
  url: string;
  title?: string;
}

/** Common dev-server ports across the popular frameworks/bundlers. */
const CANDIDATE_PORTS = [
  3000, 3001, 3002, 3003, // Next.js / CRA / Node
  5173, 5174, 4321, // Vite / Astro
  4200, // Angular
  8080, 8000, 5000, 4000, 3333, // misc dev servers
  1420, // Tauri
  6006, // Storybook
];

/** GET a URL with a short timeout; return it (with the page title) if it answers. */
async function probe(url: string, timeoutMs = 1200): Promise<LocalApp | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    // Anything that answers (even a redirect or 404) means something is listening;
    // only treat a hard server error as "not a usable app".
    if (res.status >= 500) return null;
    let title: string | undefined;
    try {
      const html = await res.text();
      title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || undefined;
    } catch {
      /* non-HTML or unreadable body — still a running app */
    }
    return { url, title };
  } catch {
    return null; // connection refused / timeout → nothing there
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe common localhost ports and return the apps that answer. `preferred` (a
 * concrete URL, if one is known) is checked first.
 */
export async function detectLocalApps(preferred?: string): Promise<LocalApp[]> {
  const urls = new Set<string>();
  if (preferred && /^https?:\/\//.test(preferred)) urls.add(preferred);
  for (const port of CANDIDATE_PORTS) urls.add(`http://localhost:${port}`);
  const results = await Promise.all([...urls].map((u) => probe(u)));
  return results.filter((r): r is LocalApp => r !== null);
}
