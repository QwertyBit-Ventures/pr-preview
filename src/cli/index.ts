import { readFileSync } from "node:fs";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { recordCommand } from "./commands/record.js";
import { runCommand } from "./commands/run.js";
import { log } from "./ui/logger.js";
import { ConfigError } from "../config/load.js";
import { GitError } from "../git/exec.js";

// Keep `--version` in sync with package.json automatically.
let version = "0.0.0";
try {
  version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
} catch {
  /* fall back to 0.0.0 if package.json can't be read */
}

const program = new Command();

program
  .name("pr-preview")
  .description("Record a UI journey once — get before/after video clips for your pull request.")
  .version(version);

program
  .command("init")
  .description("Scaffold pr-preview.config.js and .gitignore entries")
  .action(() => wrap(() => initCommand(process.cwd())));

program
  .command("record")
  .description("Record a journey to a file on the current branch (no video, no git)")
  .option("-o, --out <file>", "journey output path", ".pr-preview/journey.json")
  .action((opts) => wrap(() => recordCommand(process.cwd(), opts)));

program
  .command("run")
  .description("Record on the PR base and your branch, then produce before.mp4 and after.mp4")
  .option("-b, --base <ref>", "override PR base detection (e.g. origin/main)")
  .option("--keep-worktree", "keep the base worktree around for faster re-runs")
  .option(
    "-u, --url <url>",
    "record against an app already running at <url> — local (http://localhost:3000) or a " +
      "remote/staging URL — instead of starting a dev server",
  )
  .option(
    "-s, --single",
    "record one standalone clip of the current app, skipping the before/after comparison",
  )
  .addHelpText(
    "after",
    `
Every option can also be set in pr-preview.config.js, so a configured project runs with
just \`pr-preview run\` (handy for CI and AI agents). Flags override the config file.

Examples:
  $ pr-preview run                                   before/after: PR base vs your current branch
  $ pr-preview run --single                          one clip of the current app, no comparison
  $ pr-preview run --url http://localhost:3000       use an app you're already running (local)
  $ pr-preview run --url https://staging.example.com …or a remote / deployed app
  $ pr-preview run --base origin/develop             compare against a specific base branch

Notes:
  • --single skips git/the base worktree entirely and saves a single video — great for a demo,
    a bug repro, or a how-to.
  • --url accepts any reachable address — a local dev server or a remote/staging deployment.
    In --url mode you switch your app to the PR branch and restart it yourself between passes.
  • Without --url, a before/after run needs a git repo and to be on a branch with commits
    beyond its base (it records the base in a throwaway worktree, your branch in place).`,
  )
  .action((opts) => wrap(() => runCommand(process.cwd(), opts)));

async function wrap(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof GitError) {
      log.error(err.message);
    } else {
      log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    process.exit(1);
  }
}

program.parse();
