# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] — 2026-07-07

### Fixed

- **The cursor is visible again** — the synthetic pointer is now anchored to the
  viewport origin, so it no longer drifts off-frame (and out of the cropped clip)
  when the app centers its layout with flexbox/grid. It's also larger, with an
  always-on highlight halo, so it reads clearly once the clip is downscaled — and a
  regression test now asserts it renders and moves across captured frames.
- **Motion smoothing actually applies now** — corrected the ffmpeg `minterpolate`
  scene-change-detection argument. The previous value was an invalid token, so the
  interpolation command failed on every clip and silently fell back to a
  non-interpolated, choppy encode. MP4s now interpolate as intended, and the
  fallback logs a warning instead of failing quietly.

### Changed

- **Snappier motion** — cursor glides, scrolling, and settle pauses are quicker now
  that the capture runs at ~60fps during motion; the slow pacing was only needed for
  the old low, variable capture rate.

### Added

- **Smoother recordings** — agent-driven clips now read as fluid video instead of
  a slideshow. Three changes: (1) the CDP screencast is capped to ~the CSS window
  size so Chrome stops JPEG-encoding full Retina-resolution frames, raising the
  delivered frame rate; (2) the agent animates motion in-page — the synthetic
  cursor glides (distance-scaled), scroll eases, and text types character-by-
  character; (3) a new `gif.interpolate` option (`"blend"` default / `"mci"` /
  `"off"`) synthesises intermediate MP4 frames from the real captured frames up to
  `gif.smoothFps` (default 60), so a low, variable capture rate still plays smooth.
  `"blend"` never warps text/geometry; `"mci"` is sharper with a slight warp risk
  on fast-scrolling dense pages.

- **Claude Code integration via MCP** — a new `pr-preview mcp` command starts a
  Model Context Protocol server (stdio) so an agent can record a journey from a
  plain-English prompt. Claude reads the app's accessibility tree and drives it
  with real clicks/typing, so the existing engine captures a real live clip — it
  is agent-driven, not synthesized. Tools: `start_recording`, `snapshot`, `act`,
  `next_pass`, `finish_recording`, `open_pr`, `cancel_recording`.
- **Agent before/after** — `start_recording({ mode: "before-after" })` records the
  same journey on the PR base branch (in a git worktree) and on your branch,
  producing `before.*` and `after.*`, all driven by the agent.
- **`open_pr` tool** — commits the clip into `pr-preview/`, pushes the branch, and
  opens a pull request with the preview embedded (an inline GIF plus a link to the
  full MP4). Requires the GitHub CLI (`gh`) authenticated.
- **`detect_localhost` tool + "never guess the URL"** — probes common dev-server
  ports and reports which local apps are running (with page titles). When no URL
  is given, the agent uses it to ask which running app to record, or to ask for a
  local/staging/production URL — it never guesses.
- **`/record` slash command** — `init` installs a Claude Code skill at
  `.claude/skills/record/SKILL.md`, so you can record any flow in one line:
  `/record localhost:3000 add a book, then checkout`. It drives the recording
  through the MCP tools (agent mode). Non-destructive: skipped if it already exists.
- **`init` now writes `.mcp.json`** (merging into an existing file) so Claude Code
  discovers the server automatically, plus the `/record` skill above.
- **`init` prompts before overwriting** — when a `pr-preview` config, MCP server
  entry, or `/record` skill already exists, it asks `Overwrite it? (y/N)` instead
  of silently skipping. In a non-interactive shell (CI) it defaults to keeping the
  existing file.

### Notes

- Agent before/after needs a managed dev server (omit `url`); already-running
  apps (`--url`) remain single-clip in agent mode. Manual `pr-preview run` is
  unchanged and still supports the full `--url` before/after flow.

## [0.1.0] — 2026-06-08

Initial release.

### Added

- **Record by demonstration**: a headed-Chrome harness loads your app in an
  iframe; every click, keystroke, scroll and navigation becomes an editable
  step with a thumbnail.
- **Per-pass before/after flow**: record the journey on the PR base branch
  (run in an isolated git worktree) and again on your branch — the two UIs can
  differ completely. A 5-step wizard, tab strip with branch names, and a
  pinned action bar guide each stage.
- **High-quality output**: produces small, sharp `before.mp4` / `after.mp4`
  via ffmpeg (H.264, near-Full-HD), with an automatic GIF fallback when ffmpeg
  is absent. `format: "mp4" | "gif" | "both"`.
- **Burned-in captions**: each clip shows its branch, the base it's compared
  against, and a timestamp.
- **Resilient replay**: a synthetic cursor, human pacing, a ready-page gate,
  a manual-auth popup (passwords are never stored), and selector-drift
  recovery (retry / skip / restart the capture).
- **Cross-origin without a proxy**: the recorder is injected via Playwright's
  `exposeBinding`; only frame-busting headers (`X-Frame-Options`,
  CSP `frame-ancestors`) are stripped.
- CLI: `pr-preview init`, `pr-preview record`, `pr-preview run`.

[Unreleased]: https://github.com/QwertyBit-Ventures/pr-preview/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/QwertyBit-Ventures/pr-preview/compare/v0.1.0...v0.1.4
[0.1.0]: https://github.com/QwertyBit-Ventures/pr-preview/releases/tag/v0.1.0
