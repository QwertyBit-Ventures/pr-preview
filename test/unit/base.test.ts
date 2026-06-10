import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectBase } from "../../src/git/base.js";
import { createBaseWorktree } from "../../src/git/worktree.js";

const exec = promisify(execFile);
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

let repo: string;
let baseSha: string;

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "pr-preview-git-"));
  const git = (...args: string[]) => exec("git", args, { cwd: repo, env });

  await git("init", "-b", "main");
  await writeFile(path.join(repo, "a.txt"), "v1\n");
  await git("add", ".");
  await git("commit", "-m", "initial");
  baseSha = (await git("rev-parse", "HEAD")).stdout.trim();

  await git("checkout", "-b", "feature/change");
  await writeFile(path.join(repo, "a.txt"), "v2\n");
  await git("commit", "-am", "change");
}, 30_000);

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("detectBase", () => {
  it("finds the merge-base with main when no PR/override exists", async () => {
    const base = await detectBase(repo);
    expect(base.sha).toBe(baseSha);
    expect(base.source).toBe("merge-base");
  });

  it("honors an explicit override", async () => {
    const base = await detectBase(repo, "main");
    expect(base.sha).toBe(baseSha);
    expect(base.source).toBe("config");
  });
});

describe("createBaseWorktree", () => {
  it("creates a detached worktree at the base sha and removes it cleanly", async () => {
    const wt = await createBaseWorktree(repo, baseSha);
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: wt.dir, env });
    expect(stdout.trim()).toBe(baseSha);

    const { readFile } = await import("node:fs/promises");
    expect(await readFile(path.join(wt.dir, "a.txt"), "utf8")).toBe("v1\n");

    await wt.remove();
    const { existsSync } = await import("node:fs");
    expect(existsSync(wt.dir)).toBe(false);
  });

  it("reuses an intact worktree on the second call", async () => {
    const wt1 = await createBaseWorktree(repo, baseSha);
    const wt2 = await createBaseWorktree(repo, baseSha);
    expect(wt2.dir).toBe(wt1.dir);
    await wt1.remove();
  });
});
