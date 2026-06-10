import { git, tryGit, tryGh, GitError } from "./exec.js";

export interface BaseInfo {
  /** Commit sha the "before" worktree is created at (merge-base). */
  sha: string;
  /** Where the base came from, for logging. */
  source: "gh-pr" | "config" | "merge-base";
  ref: string;
}

/**
 * Determine the PR base commit:
 *  1. explicit config override
 *  2. `gh pr view` if the branch has an open PR
 *  3. merge-base with origin/HEAD → main → master → develop
 */
export async function detectBase(repoRoot: string, override?: string): Promise<BaseInfo> {
  // Friendly pre-flight: a git repo with no commits / no HEAD can't be diffed.
  if (!(await tryGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]))) {
    throw new GitError(
      `Not inside a git repository (${repoRoot}). pr-preview run needs a git repo with a ` +
        `committed base branch — cd into your project and try again.`,
    );
  }
  if (!(await tryGit(repoRoot, ["rev-parse", "--verify", "HEAD"]))) {
    throw new GitError(
      `This git repository has no commits yet, so there is no base to compare against. ` +
        `Commit your work and run pr-preview on a feature branch (or pass --base <ref>).`,
    );
  }

  if (override) {
    const sha = await git(repoRoot, ["merge-base", "HEAD", override]);
    return { sha, source: "config", ref: override };
  }

  const ghBase = await tryGh(repoRoot, ["pr", "view", "--json", "baseRefName", "-q", ".baseRefName"]);
  if (ghBase) {
    const ref = (await tryGit(repoRoot, ["rev-parse", "--verify", `origin/${ghBase}`]))
      ? `origin/${ghBase}`
      : ghBase;
    const sha = await tryGit(repoRoot, ["merge-base", "HEAD", ref]);
    if (sha) return { sha, source: "gh-pr", ref };
  }

  const candidates: string[] = [];
  const originHead = await tryGit(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (originHead) candidates.push(originHead.replace("refs/remotes/", ""));
  candidates.push("origin/main", "origin/master", "main", "master", "develop");

  const current = await git(repoRoot, ["rev-parse", "HEAD"]);
  for (const ref of candidates) {
    if (!(await tryGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]))) continue;
    const sha = await tryGit(repoRoot, ["merge-base", "HEAD", ref]);
    // A base equal to HEAD means we're ON the default branch — keep looking.
    if (sha && sha !== current) return { sha, source: "merge-base", ref };
    if (sha && sha === current) {
      throw new GitError(
        `Your branch has no commits beyond ${ref}, so there's no "before" to compare against.\n\n` +
          `  • If your changes aren't committed yet, commit them — then ${ref} becomes the "before"\n` +
          `    and your commit the "after".\n` +
          `  • Or switch to your PR branch, or pass --base <ref> to choose a different base.\n` +
          `  • Or skip the comparison and record a single clip: pr-preview run --single`,
      );
    }
  }
  throw new GitError(
    "Could not detect the PR base. Pass --base <ref> or set baseBranch in pr-preview.config.",
  );
}
