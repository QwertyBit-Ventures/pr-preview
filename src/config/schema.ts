import { z } from "zod";

export const configSchema = z.object({
  /** Command that starts the project's dev server, e.g. "npm run dev". */
  devCommand: z.string().min(1),
  /** URL the app is reachable on once ready. Supports {port} templating. */
  url: z.string().min(1),
  /** Working directory of the frontend relative to the repo root (monorepos). */
  cwd: z.string().default("."),
  /** ms to wait for the dev server to answer. */
  readyTimeout: z.number().int().positive().default(60_000),
  /** Override PR base detection (the "before" ref). e.g. "origin/main". */
  baseBranch: z.string().optional(),
  /**
   * Run against an app YOU already have running, instead of letting pr-preview
   * start a dev server in a worktree. Set this (e.g. "http://localhost:3000")
   * for apps that need real env/backends. Equivalent to `run --url`; the CLI
   * flag overrides it. When set, devCommand/url are ignored for `run`.
   */
  externalUrl: z.string().optional(),
  /** Reuse the base worktree across runs (skips reinstall). `--keep-worktree`. */
  keepWorktree: z.boolean().default(false),
  /** Dependency install behavior in the base worktree. */
  install: z.enum(["auto", "always", "never"]).default("auto"),
  /** Output directory for the clips, relative to repo root. */
  output: z.string().default(".pr-preview/output"),
  /**
   * Output format. "mp4" (default) is small + HQ and uploads straight into a
   * GitHub PR description; needs ffmpeg on PATH (falls back to gif if
   * missing). "both" produces the two side by side.
   */
  format: z.enum(["mp4", "gif", "both"]).default("mp4"),
  /**
   * How many recordings the session does: 2 (default) = before/after on the
   * base branch and your branch; 1 = a single standalone clip of the current
   * app (no comparison, no base worktree). `run --single` forces 1.
   */
  passes: z.union([z.literal(1), z.literal(2)]).default(2),
  gif: z
    .object({
      width: z.number().int().positive().default(900),
      // 24fps keeps the synthetic cursor's motion fluid in the clip.
      fps: z.number().positive().max(60).default(24),
      quality: z.enum(["high", "max"]).default("high"),
      maxColors: z.number().int().min(2).max(256).default(256),
    })
    .default({}),
  /**
   * Start-of-pass reset choice default: true (default) offers "reset" (clear
   * cookies + localStorage + sessionStorage and reload) before recording;
   * false offers "keep my session". The nudge only appears when there's state
   * to reset.
   */
  resetStorage: z.boolean().default(true),
  /** Logical app resolution — Full HD by default. The harness scales the
   *  iframe down to fit the window, keeping this resolution and ratio. */
  viewport: z
    .object({
      width: z.number().int().positive().default(1920),
      height: z.number().int().positive().default(1080),
    })
    .default({}),
  /** Strip X-Frame-Options / frame-ancestors so any app loads in the iframe. */
  headerStrip: z.boolean().default(true),
  /**
   * Browser permissions to GRANT up front (Playwright names) so a native
   * prompt never blocks the run. Defaults to allow-all (the broadly-supported
   * set); unsupported names for your Chrome are skipped gracefully. Set your
   * own narrower list to override, or [] to deny everything.
   */
  permissions: z
    .array(z.string())
    .default([
      "geolocation",
      "notifications",
      "camera",
      "microphone",
      "clipboard-read",
      "clipboard-write",
      "midi",
      "background-sync",
      "accelerometer",
      "gyroscope",
      "magnetometer",
      "payment-handler",
      "storage-access",
    ]),
  /**
   * Fixed geolocation for the session (implies the "geolocation" permission),
   * so location-based apps render real, deterministic results in both clips.
   */
  geolocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracy: z.number().nonnegative().optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

/** Replace {port} in the configured url. */
export function resolveUrl(config: Config, port: number): string {
  return config.url.replace("{port}", String(port));
}
