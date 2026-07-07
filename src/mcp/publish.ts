import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { git, tryGit } from "../git/exec.js";
import { ffmpegAvailable } from "../encode/ffmpeg.js";

const pexec = promisify(execFile);

/** Run a command, surfacing stderr in the thrown error for clear diagnostics. */
async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await pexec(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`\`${cmd} ${args.slice(0, 2).join(" ")}\` failed: ${(err.stderr || err.message || String(e)).trim()}`);
  }
}

export interface OpenPrResult {
  prUrl: string;
  committed: string[];
  embedded: "gif" | "mp4-link";
}

/**
 * Commit an embeddable clip into `pr-preview/`, push the current branch, and
 * open a pull request with the preview in the body.
 *
 * Honest constraint: GitHub only plays inline video from its own attachment CDN
 * (no public API), so the open-source path embeds an animated **GIF** (which
 * renders inline) and links the full-quality MP4. One-click hosted video in the
 * PR body is what PR Preview for Teams adds on top.
 */
export async function openPr(
  repoRoot: string,
  files: string[],
  opts: { title?: string; base?: string } = {},
): Promise<OpenPrResult> {
  if (files.length === 0) {
    throw new Error("No clip files provided — run finish_recording first and pass its output paths.");
  }

  // 0. Preconditions.
  try {
    await run("gh", ["--version"], repoRoot);
  } catch {
    throw new Error("GitHub CLI (gh) not found. Install it from https://cli.github.com, then `gh auth login`.");
  }
  try {
    await run("gh", ["auth", "status"], repoRoot);
  } catch {
    throw new Error("GitHub CLI isn't authenticated. Run `gh auth login`, then try again.");
  }
  const branch = await tryGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch) throw new Error("You're on a detached HEAD. Check out your PR branch first.");
  if (!(await tryGit(repoRoot, ["remote", "get-url", "origin"]))) {
    throw new Error("No `origin` remote found. Add one (and push the branch), then retry.");
  }
  const slug = await repoSlug(repoRoot);

  // 1. Copy clips into a committed folder; pick/derive an embeddable GIF.
  const abs = files.map((f) => (path.isAbsolute(f) ? f : path.resolve(repoRoot, f)));
  for (const f of abs) if (!existsSync(f)) throw new Error(`Clip file not found: ${f}`);

  const destDir = path.join(repoRoot, "pr-preview");
  await mkdir(destDir, { recursive: true });

  const committed: string[] = [];
  let embedGifRel: string | null = null;
  const mp4Rel: string[] = [];

  for (const f of abs) {
    const base = path.basename(f);
    await copyFile(f, path.join(destDir, base));
    committed.push(`pr-preview/${base}`);
    if (base.endsWith(".gif") && !embedGifRel) embedGifRel = `pr-preview/${base}`;
    if (base.endsWith(".mp4")) mp4Rel.push(`pr-preview/${base}`);
  }

  // No GIF among the outputs → transcode the first MP4 so the PR can show an
  // animated preview inline.
  if (!embedGifRel && mp4Rel.length && (await ffmpegAvailable())) {
    const src = path.join(repoRoot, mp4Rel[0]!);
    const gifName = path.basename(mp4Rel[0]!).replace(/\.mp4$/, ".gif");
    await run(
      "ffmpeg",
      ["-y", "-i", src, "-vf", "fps=15,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", path.join(destDir, gifName)],
      repoRoot,
    );
    committed.push(`pr-preview/${gifName}`);
    embedGifRel = `pr-preview/${gifName}`;
  }

  // 2. Commit + push.
  await git(repoRoot, ["add", "--", ...committed]);
  try {
    await git(repoRoot, ["commit", "-m", "Add PR preview clip"]);
  } catch (e) {
    if (!/nothing to commit/i.test(String(e))) throw e;
  }
  await run("git", ["push", "-u", "origin", branch], repoRoot);

  // 3. Body with an embedded preview + MP4 link(s).
  const rawBase = `https://github.com/${slug}/raw/${branch}`;
  const body = buildBody(embedGifRel, mp4Rel, rawBase);

  // 4. Open the PR.
  const args = ["pr", "create", "--title", opts.title ?? `Preview: ${branch}`, "--body", body, "--head", branch];
  if (opts.base) args.push("--base", opts.base);
  const prUrl = await run("gh", args, repoRoot);

  return { prUrl, committed, embedded: embedGifRel ? "gif" : "mp4-link" };
}

function buildBody(gifRel: string | null, mp4Rel: string[], rawBase: string): string {
  const lines = ["## PR Preview", ""];
  if (gifRel) lines.push(`![PR preview](${rawBase}/${gifRel})`, "");
  if (mp4Rel.length) {
    lines.push("Full-quality MP4:");
    for (const m of mp4Rel) lines.push(`- [${path.basename(m)}](${rawBase}/${m})`);
    lines.push("");
  }
  lines.push("<sub>Recorded with [PR Preview](https://pr-preview.com) via Claude Code.</sub>");
  return lines.join("\n");
}

async function repoSlug(repoRoot: string): Promise<string> {
  try {
    return await run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], repoRoot);
  } catch {
    /* fall back to parsing the origin remote */
  }
  const url = (await tryGit(repoRoot, ["remote", "get-url", "origin"])) ?? "";
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) throw new Error("Couldn't determine the GitHub owner/repo from the origin remote.");
  return m[1]!;
}
