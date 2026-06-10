import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { git, tryGit, GitError } from "./exec.js";

const WORKTREE_DIR = ".pr-preview/worktrees";

/**
 * git crashing with a signal (SIGBUS/SIGSEGV → "died of signal", exit 138)
 * while reading objects almost always means the repo's object files are
 * iCloud-evicted "dataless" placeholders (repo lives in ~/Documents). Turn
 * the raw crash into an actionable message.
 */
function explainGitCrash(err: unknown, repoRoot: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/died of signal|signal 1[01]\b|SIGBUS|SIGSEGV/i.test(msg)) {
    const inICloud = /\/(Documents|Desktop)\//.test(repoRoot);
    throw new GitError(
      `git crashed creating the base worktree (it died of a signal). This usually means ` +
        `the repository's git objects are iCloud-evicted "dataless" placeholders` +
        (inICloud ? " — and this repo is under ~/Documents, which iCloud syncs.\n\n" : ".\n\n") +
        `Fixes:\n` +
        `  • Move the repo out of iCloud (e.g. ~/dev), or disable Desktop & Documents sync, then retry.\n` +
        `  • Or force-download the objects now:  find .git -type f -exec cat {} + >/dev/null\n` +
        `\nOriginal error: ${msg}`,
    );
  }
  throw err;
}

export interface WorktreeHandle {
  dir: string;
  remove(): Promise<void>;
}

/** Create a detached worktree at the given sha for the "before" app. */
export async function createBaseWorktree(repoRoot: string, sha: string): Promise<WorktreeHandle> {
  const dir = path.join(repoRoot, WORKTREE_DIR, `base-${sha.slice(0, 12)}`);

  // Reuse an intact worktree from a previous run (skips reinstall).
  if (existsSync(dir) && (await tryGit(dir, ["rev-parse", "HEAD"])) === sha) {
    return { dir, remove: () => removeWorktree(repoRoot, dir) };
  }

  await pruneStaleWorktrees(repoRoot);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  try {
    await git(repoRoot, ["worktree", "add", "--detach", dir, sha]);
  } catch (err) {
    // A half-created worktree leaves a registration behind — clean it up.
    await removeWorktree(repoRoot, dir).catch(() => {});
    explainGitCrash(err, repoRoot);
  }
  return { dir, remove: () => removeWorktree(repoRoot, dir) };
}

export async function removeWorktree(repoRoot: string, dir: string): Promise<void> {
  await tryGit(repoRoot, ["worktree", "remove", "--force", dir]);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await tryGit(repoRoot, ["worktree", "prune"]);
}

export async function pruneStaleWorktrees(repoRoot: string): Promise<void> {
  await tryGit(repoRoot, ["worktree", "prune"]);
}
