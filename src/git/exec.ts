import { execFile } from "node:child_process";

export class GitError extends Error {}

/** Run a git command in dir and return trimmed stdout; throws GitError on failure. */
export function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: dir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new GitError(`git ${args.join(" ")} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

/** Like git() but null on failure — for probes. */
export async function tryGit(dir: string, args: string[]): Promise<string | null> {
  try {
    return await git(dir, args);
  } catch {
    return null;
  }
}

/** Run `gh` and return trimmed stdout, or null if unavailable/failed. */
export function tryGh(dir: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd: dir }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}
