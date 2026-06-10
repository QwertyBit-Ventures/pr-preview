import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { installHeaderStrip } from "./headerStrip.js";
import { installRecorderBinding, type RawEventHandler } from "./recorderInject.js";

/** Harness chrome around the app iframe — must match harness/src CSS. */
export const SIDEBAR_WIDTH = 320;
export const BANNER_HEIGHT = 44 + 36; // banner + tab strip

export interface SessionOptions {
  harnessUrl: string;
  /** All origins the app iframe may live on across the run (before + after). */
  targetOrigins: string[];
  appViewport: { width: number; height: number };
  headerStrip: boolean;
  onRawEvent: RawEventHandler;
  /** Permissions to grant up front (e.g. "geolocation", "clipboard-read"). */
  permissions?: string[];
  /** Fixed geolocation; implies the "geolocation" permission. */
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/**
 * Local/Private Network Access features to disable so the harness (127.0.0.1)
 * can embed an app on localhost:PORT and that app can make its own localhost
 * requests (HMR sockets, RSC/data fetches). Without this Chrome blocks them and
 * the page renders but never hydrates → nothing is clickable.
 */
const LNA_DISABLE = [
  "LocalNetworkAccessChecks",
  "BlockInsecurePrivateNetworkRequests",
  "PrivateNetworkAccessSendPreflights",
  "PrivateNetworkAccessForNavigations",
];

let cachedBaseDisabledFeatures: string | null = null;

/**
 * Discover Playwright's own default `--disable-features` value (probed once per
 * process). Chrome honors only the LAST `--disable-features`, so to add ours
 * without clobbering Playwright's we must concatenate onto theirs.
 */
async function playwrightDisabledFeatures(): Promise<string> {
  if (cachedBaseDisabledFeatures !== null) return cachedBaseDisabledFeatures;
  cachedBaseDisabledFeatures = "";
  try {
    const probe = await chromium.launchServer({ headless: true });
    const arg = probe.process().spawnargs.find((a) => a.startsWith("--disable-features="));
    cachedBaseDisabledFeatures = arg ? arg.slice("--disable-features=".length) : "";
    await probe.close();
  } catch {
    /* probe failed — we'll skip the LNA flag rather than clobber theirs */
  }
  return cachedBaseDisabledFeatures;
}

/**
 * Grant permissions across all origins. Tries the whole list at once; if Chrome
 * rejects an unknown name, falls back to granting each individually so the
 * supported ones still apply (and unsupported ones are simply skipped).
 */
async function grantPermissionsResilient(context: BrowserContext, perms: string[]): Promise<void> {
  if (perms.length === 0) return;
  try {
    await context.grantPermissions(perms);
  } catch {
    // grantPermissions REPLACES the granted set, so accumulate the valid names
    // and re-grant the growing set — skipping any this Chrome doesn't know.
    const good: string[] = [];
    for (const p of perms) {
      try {
        await context.grantPermissions([...good, p]);
        good.push(p);
      } catch {
        /* unsupported name — skip it, keep the rest */
      }
    }
  }
}

/**
 * Launch headed Chrome on the harness page. The window is freely resizable
 * (viewport: null = real window size); the harness letterboxes the app
 * iframe at its exact configured size so resizing never distorts it. The
 * initial window is sized to fit the iframe + sidebar + banner.
 */
export async function launchSession(opts: SessionOptions): Promise<BrowserSession> {
  const headless = process.env.PR_PREVIEW_HEADLESS === "1"; // CI/tests only
  const windowChrome = headless ? 0 : 88; // headed Chrome UI (tabs + URL bar)

  // Disable Local/Private Network Access checks, MERGED into Playwright's own
  // --disable-features so we don't re-enable the features it deliberately turns
  // off. If the probe failed, skip rather than clobber.
  const baseDisabled = await playwrightDisabledFeatures();
  const args = [
    "--hide-crash-restore-bubble",
    // Auto-accept camera/mic prompts with a fake device so getUserMedia
    // never blocks the run.
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    // Reduce the automation fingerprint (hides navigator.webdriver) so OAuth
    // providers like Google are less likely to refuse sign-in with "this
    // browser may not be secure". Not a guarantee — they're aggressive.
    "--disable-blink-features=AutomationControlled",
    `--window-size=${opts.appViewport.width + SIDEBAR_WIDTH},${
      opts.appViewport.height + BANNER_HEIGHT + windowChrome
    }`,
  ];
  if (baseDisabled) args.push(`--disable-features=${[baseDisabled, ...LNA_DISABLE].join(",")}`);

  const browser = await chromium.launch({
    headless,
    args,
    // Drop the "controlled by automation" flag — another OAuth-detection signal.
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const context = await browser.newContext({
    viewport: null, // follow the real window — user can resize freely
  });

  // Grant permissions so a native prompt never blocks the run. Granted on the
  // context (all origins) and resiliently — names unsupported by this Chrome
  // are skipped instead of failing the whole launch.
  const permissions = new Set(opts.permissions ?? []);
  if (opts.geolocation) permissions.add("geolocation");
  await grantPermissionsResilient(context, [...permissions]);

  // A position so geolocation resolves (no prompt, no hang) — the configured
  // one, or a neutral default when location is allowed but unset.
  const geolocation = opts.geolocation ?? (permissions.has("geolocation") ? { latitude: 0, longitude: 0 } : undefined);
  if (geolocation) await context.setGeolocation(geolocation).catch(() => {});

  if (opts.headerStrip) await installHeaderStrip(context, opts.targetOrigins);

  const page = await context.newPage();

  // Native dialogs (alert/confirm/prompt) would otherwise be auto-dismissed by
  // Playwright — breaking flows that expect "OK"/"Confirm". Accept them (with
  // the prompt's default value) so the journey proceeds, in both record and
  // replay. Pages without a dialog listener just never trigger this.
  context.on("dialog", (dialog) => {
    void dialog.accept(dialog.type() === "prompt" ? dialog.defaultValue() : undefined).catch(() => {});
  });

  await installRecorderBinding(page, opts.targetOrigins, opts.onRawEvent);
  await page.goto(opts.harnessUrl, { waitUntil: "domcontentloaded" });

  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
