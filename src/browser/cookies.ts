import { existsSync, readFileSync } from "node:fs";
import type { BrowserContext } from "playwright";

type Cookies = Parameters<BrowserContext["addCookies"]>[0];

/**
 * The cookies in the JSON file `PR_PREVIEW_COOKIES_FILE` names (Playwright's `addCookies` shape), or none when it is
 * unset. They let a recording start signed in to an app whose sign-in can't be completed in the window, such as an
 * emailed magic link or code, with a session obtained some other way (a test account, an API).
 */
export function readCookiesFile(file: string | undefined = process.env.PR_PREVIEW_COOKIES_FILE): Cookies {
  if (!file) return [];
  if (!existsSync(file)) throw new Error(`PR_PREVIEW_COOKIES_FILE: ${file} does not exist`);
  const cookies: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(cookies)) throw new Error(`PR_PREVIEW_COOKIES_FILE: ${file} is not a JSON array of cookies`);
  return cookies as Cookies;
}

/** Adds the cookies file's cookies to a context: when the browser launches, and again after a storage reset. */
export async function seedCookies(context: BrowserContext): Promise<void> {
  const cookies = readCookiesFile();
  if (cookies.length > 0) await context.addCookies(cookies);
}
