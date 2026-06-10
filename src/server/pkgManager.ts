import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(dir, "bun.lockb")) || existsSync(path.join(dir, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

/** Run `<pm> install` in dir; resolves on exit 0, rejects otherwise. */
export function installDependencies(dir: string, pm: PackageManager): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pm, ["install"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let tail = "";
    const keepTail = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-2000);
    };
    child.stdout.on("data", keepTail);
    child.stderr.on("data", keepTail);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${pm} install failed (exit ${code}):\n${tail}`));
    });
  });
}
