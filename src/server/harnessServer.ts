import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Bus } from "../ipc/bus.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".map": "application/json",
};

export interface HarnessServerOptions {
  port: number;
  /** URL of the target app the iframe should load. */
  appUrl: string;
  mode: "record" | "run";
  /** Fixed logical size of the app iframe (letterboxed in the stage). */
  viewport: { width: number; height: number };
}

export interface HarnessServer {
  url: string;
  bus: Bus;
  setAppUrl(url: string): void;
  close(): Promise<void>;
}

/** Locate the built harness SPA (dist/harness next to the CLI bundle). */
function harnessDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli/index.js → dist/harness ; src fallback for tests/dev
  const candidates = [
    path.resolve(here, "../harness"),
    path.resolve(here, "../../dist/harness"),
  ];
  const found = candidates.find((c) => existsSync(path.join(c, "index.html")));
  if (!found) {
    throw new Error(
      `Harness UI build not found (looked in: ${candidates.join(", ")}). Run \`npm run build\` first.`,
    );
  }
  return found;
}

/** Serve the sidebar SPA, a /runtime.json config endpoint and the /ws bus. */
export async function startHarnessServer(opts: HarnessServerOptions): Promise<HarnessServer> {
  const dist = harnessDistDir();
  let appUrl = opts.appUrl;

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0]!;
    if (urlPath === "/runtime.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ appUrl, mode: opts.mode, viewport: opts.viewport }));
      return;
    }
    const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const file = path.join(dist, path.normalize(rel));
    if (!file.startsWith(dist) || !existsSync(file)) {
      // SPA fallback
      res.writeHead(200, { "content-type": MIME[".html"]! });
      res.end(await readFile(path.join(dist, "index.html")));
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(file));
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const bus = new Bus();
  bus.attach(wss);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });

  return {
    url: `http://127.0.0.1:${opts.port}`,
    bus,
    setAppUrl(url: string) {
      appUrl = url;
    },
    close: () =>
      new Promise((resolve) => {
        wss.close();
        for (const ws of wss.clients) ws.terminate();
        server.close(() => resolve());
      }),
  };
}
