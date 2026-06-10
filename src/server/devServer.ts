import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import treeKill from "tree-kill";

export interface DevServerOptions {
  command: string; // e.g. "npm run dev"
  cwd: string;
  port: number; // exposed as $PORT to the command
  url: string; // polled for readiness
  readyTimeout: number;
  logFile?: string;
}

export class DevServerError extends Error {}

export interface DevServerHandle {
  url: string;
  stop(): Promise<void>;
}

/** Spawn the project dev server and wait until `url` answers. */
export async function startDevServer(opts: DevServerOptions): Promise<DevServerHandle> {
  if (opts.logFile) mkdirSync(path.dirname(opts.logFile), { recursive: true });

  const child = spawn(opts.command, {
    cwd: opts.cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(opts.port), BROWSER: "none", FORCE_COLOR: "0" },
  });

  let logTail = "";
  const onChunk = (chunk: Buffer) => {
    logTail = (logTail + chunk.toString()).slice(-4000);
    if (opts.logFile) appendFileSync(opts.logFile, chunk);
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  let exited = false;
  let exitCode: number | null = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  const deadline = Date.now() + opts.readyTimeout;
  while (Date.now() < deadline) {
    if (exited) {
      throw new DevServerError(
        `Dev server exited early (code ${exitCode}). Last output:\n${logTail}`,
      );
    }
    try {
      const res = await fetch(opts.url, { redirect: "manual" });
      if (res.status < 500) {
        return { url: opts.url, stop: () => killTree(child) };
      }
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }

  await killTree(child);
  throw new DevServerError(
    `Dev server did not answer at ${opts.url} within ${opts.readyTimeout}ms. Last output:\n${logTail}`,
  );
}

function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.pid == null || child.exitCode !== null) return resolve();
    treeKill(child.pid, "SIGTERM", () => {
      // escalate if still alive shortly after
      setTimeout(() => {
        if (child.exitCode === null && child.pid != null) {
          treeKill(child.pid, "SIGKILL", () => resolve());
        } else {
          resolve();
        }
      }, 1500);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
