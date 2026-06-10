import path from "node:path";
import type { Config } from "../config/schema.js";
import { resolveUrl } from "../config/schema.js";
import { allocatePorts, type PortPlan } from "../server/ports.js";
import { startDevServer, type DevServerHandle } from "../server/devServer.js";
import { startHarnessServer, type HarnessServer } from "../server/harnessServer.js";
import { launchSession, type BrowserSession } from "../browser/launch.js";
import { Session } from "./session.js";
import { registerCleanup } from "../cli/cleanup.js";
import { log } from "../cli/ui/logger.js";

export interface Bootstrapped {
  ports: PortPlan;
  harness: HarnessServer;
  session: Session;
  appUrl(which: "before" | "after"): string;
  startApp(which: "before" | "after", cwd: string): Promise<DevServerHandle>;
  /** Launch headed Chrome on the harness (call after the first app is up). */
  openBrowser(which: "before" | "after"): Promise<BrowserSession>;
  /** Point the open harness iframe at the other app. */
  switchApp(which: "before" | "after"): Promise<void>;
}

/**
 * Wire up everything a harness session needs: ports, harness server, bus and
 * session state machine. Dev servers and the browser start on demand so
 * `run` can sequence before/after.
 */
export async function bootstrap(
  repoRoot: string,
  config: Config,
  mode: "record" | "run",
  opts: { fixedUrl?: string } = {},
): Promise<Bootstrapped> {
  const ports = await allocatePorts();
  // `fixedUrl` = the user runs the app themselves; both passes use that one
  // URL (they switch branches + restart between them). No dev server, no ports.
  const appUrl = (which: "before" | "after") =>
    opts.fixedUrl ?? resolveUrl(config, which === "before" ? ports.beforeApp : ports.afterApp);

  const initial = mode === "run" ? "before" : "after";
  const harness = await startHarnessServer({
    port: ports.harness,
    appUrl: appUrl(initial),
    mode,
    viewport: config.viewport,
  });
  registerCleanup(() => harness.close());

  const session = new Session(harness.bus, config, mode, appUrl(initial));
  let browser: BrowserSession | null = null;

  return {
    ports,
    harness,
    session,
    appUrl,

    async startApp(which, cwd) {
      const port = which === "before" ? ports.beforeApp : ports.afterApp;
      const url = appUrl(which);
      const spinner = log.spinner(`Starting ${which} dev server (${config.devCommand}) …`);
      try {
        const handle = await startDevServer({
          command: config.devCommand,
          cwd: path.join(cwd, config.cwd),
          port,
          url,
          readyTimeout: config.readyTimeout,
          logFile: path.join(repoRoot, ".pr-preview", `dev-${which}.log`),
        });
        registerCleanup(() => handle.stop());
        spinner.succeed(`${which} app ready at ${url}`);
        return handle;
      } catch (err) {
        spinner.fail(`${which} dev server failed`);
        throw err;
      }
    },

    async openBrowser(which) {
      browser = await launchSession({
        harnessUrl: harness.url,
        targetOrigins: [new URL(appUrl("before")).origin, new URL(appUrl("after")).origin],
        appViewport: config.viewport,
        headerStrip: config.headerStrip,
        onRawEvent: session.handleRawEvent,
        permissions: config.permissions,
        geolocation: config.geolocation,
      });
      registerCleanup(() => browser!.close());
      session.attachPage(browser.page, appUrl(which));
      return browser;
    },

    async switchApp(which) {
      if (!browser) throw new Error("Browser not open");
      harness.setAppUrl(appUrl(which));
      session.attachPage(browser.page, appUrl(which));
      // Harness refetches runtime.json on load → iframe points at the new app.
      await browser.page.reload({ waitUntil: "domcontentloaded" });
    },
  };
}
