# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/QwertyBit-Ventures/pr-preview/releases/tag/v0.1.0
