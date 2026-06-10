import path from "node:path";
import pc from "picocolors";
import { loadConfig } from "../../config/load.js";
import { bootstrap } from "../../session/bootstrap.js";
import { saveJourney } from "../../recorder/journey.js";
import { log } from "../ui/logger.js";
import { runCleanups } from "../cleanup.js";

export interface RecordOptions {
  out?: string;
}

/** Record a journey on the current branch only — no GIFs, no git. */
export async function recordCommand(repoRoot: string, opts: RecordOptions): Promise<void> {
  const { config } = await loadConfig(repoRoot);
  const journeyFile = path.resolve(repoRoot, opts.out ?? ".pr-preview/journey.json");

  try {
    const boot = await bootstrap(repoRoot, config, "record");
    await boot.startApp("after", repoRoot);
    await boot.openBrowser("after");

    log.info(`Harness open at ${pc.bold(boot.harness.url)}`);
    log.step("Click Record in the sidebar, perform the journey, then Confirm.");

    const steps = await boot.session.recordUntilConfirmed();
    if (steps.length === 0) {
      log.warn("No steps recorded — nothing saved.");
      return;
    }

    await saveJourney(journeyFile, {
      version: 1,
      createdAt: new Date().toISOString(),
      viewport: { ...config.viewport, deviceScaleFactor: 2 },
      startUrl: boot.session.startUrl,
      steps,
    });
    log.success(`Saved ${steps.length} steps to ${path.relative(repoRoot, journeyFile)}`);
  } finally {
    await runCleanups();
  }
}
