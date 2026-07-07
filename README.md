<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@qwertybit/pr-preview/assets/logo-wordmark.png" alt="PR Preview" width="280" />
</p>

<p align="center">
  <strong>See what your PR changed — before &amp; after, in a clip.</strong><br/>
  A free, open-source CLI that records a journey through your app and turns it into a polished
  before/after video for your pull request.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@qwertybit/pr-preview"><img src="https://img.shields.io/npm/v/@qwertybit/pr-preview?color=635bff" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@qwertybit/pr-preview?color=2da44e" alt="MIT license" /></a>
  <img src="https://img.shields.io/node/v/@qwertybit/pr-preview" alt="node >= 20" />
  <a href="https://pr-preview.com"><img src="https://img.shields.io/badge/website-pr--preview.com-635bff" alt="pr-preview.com" /></a>
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@qwertybit/pr-preview/assets/demo.gif" alt="PR Preview demo — a Claude Code prompt drives the app in Chrome and produces before/after videos" width="720" />
</p>

<p align="center">
  <a href="https://cdn.jsdelivr.net/npm/@qwertybit/pr-preview/assets/demo.mp4">▶ Watch in higher quality (MP4)</a>
</p>

**PR Preview** opens your app in a controlled Chrome window and records the journey you perform —
clicking through a feature, logging in, submitting a form. The recording *is* the clip (no replay,
no flaky re-enactment), so what you did is exactly what reviewers see. Do it on your PR's base
branch and on your branch and you get two high-quality videos you can drag straight into a GitHub
pull request:

| `before.mp4` | `after.mp4` |
| --- | --- |
| your journey on the base branch | the same journey, with your changes |

No CI to set up, no scripts to write. It runs locally, against your real dev server, and ships in
about a minute.

> **Why it matters:** in the AI era, more of every diff is machine-generated, and reviewers
> can't infer how the UI behaves from reading generated code. A 15-second before/after clip makes
> the visual change obvious in seconds — and turns "LGTM" into an actual review.

---

## Features

- **Record by demonstration** — just use your app. Clicks, typing, scrolling and navigation are
  captured as an editable outline; no selectors or scripts to hand-write.
- **Live capture, zero drift** — the clip is your real recording, not a replay, so it never
  desyncs on stateful apps. A synthetic cursor makes every move easy to follow.
- **True before/after** — the base branch runs in an isolated git **worktree**; your working
  tree is never touched. Or point it at an app you already run with `--url`.
- **Tiny, sharp MP4s** — H.264, near-Full-HD, a few hundred KB. GitHub renders them inline in a
  PR. High-quality GIF fallback when ffmpeg isn't installed.
- **Runs entirely on your machine** — nothing is uploaded. Your source and app data never leave
  your computer.
- **Self-describing clips** — each is captioned with its branch and a timestamp.
- **Drive it from Claude Code** — a built-in MCP server lets Claude record a journey for you from
  a plain-English prompt: it opens Chrome, performs the flow step by step, and can even open the PR.
  Agent-driven, but still a real capture of your real app — never synthesized. Manual mode still works.

## Install

```bash
npm i -D @qwertybit/pr-preview
npx playwright install chromium   # one-time browser download
npx pr-preview init               # scaffolds pr-preview.config.js + .mcp.json (Claude Code)
```

> **ffmpeg** (optional, recommended) gives you MP4 output. macOS: `brew install ffmpeg` ·
> Debian/Ubuntu: `apt install ffmpeg`. Without it, PR Preview produces a high-quality GIF instead.

## Quick start

On your PR branch:

```bash
npx pr-preview run
```

That's it. PR Preview will:

1. Detect your PR base, check it out into a worktree, and start its dev server.
2. Open Chrome with the recording harness. **Record** your journey → **Confirm** → `before.mp4`.
3. Switch to your branch's app, record the same journey (or reuse the BEFORE outline) → **Save** →
   `after.mp4`.
4. Open the output folder.

Both clips land in `.pr-preview/output/`. Drag them into your PR description — done.

Just need one clip (a demo, a bug repro)? `npx pr-preview run --single` records a single standalone
video, no comparison.

## How it works

A run is a short wizard shown in the harness sidebar:

```
①────────②────────③────────④────────⑤
Record    Capture   Record    Capture   Generate
(base)    before    (branch)  after     files
```

- **The clip is the recording.** Frames are captured live as you perform the journey, then trimmed
  at the ends and captioned — so it looks polished without the drift of re-enacting steps.
- **Before and after are recorded separately** (a PR can change the UI completely). If the flows
  match, a **Load BEFORE steps** shortcut reuses the outline as a checklist.
- **Reset nudge** at the start of each pass lets you clear cookies/storage for a clean start, or
  keep a session you set up by hand (e.g. a manual login) — only shown when there's state to reset.
- **Refresh button** in the frame corner reloads the app whenever you need a clean slate.

## Output

| `format` | Result | Needs ffmpeg |
| --- | --- | --- |
| `"mp4"` *(default)* | `before.mp4`, `after.mp4` | yes (falls back to GIF) |
| `"gif"` | `before.gif`, `after.gif` | no |
| `"both"` | both pairs | yes |

MP4 is recommended: full color, far smaller than GIF, and GitHub embeds it inline.

## Configuration

Everything lives in `pr-preview.config.js` (or `.ts` / `.json`), so a project is set up once and
runs with **no flags**:

```js
/** @type {import('@qwertybit/pr-preview').Config} */
export default {
  devCommand: "npm run dev",        // required — $PORT is provided
  url: "http://localhost:{port}",   // required — {port} is templated in
  cwd: ".",                         // frontend dir (for monorepos)
  readyTimeout: 60000,              // ms to wait for the dev server

  // Run options (set once here instead of passing CLI flags each time):
  externalUrl: undefined,           // use an app you already run (skip the dev server)
  baseBranch: undefined,            // override base ("before") detection
  keepWorktree: false,              // reuse the base worktree across runs

  output: ".pr-preview/output",
  format: "mp4",                    // "mp4" | "gif" | "both"
  passes: 2,                        // 2 = before/after · 1 = single clip
  resetStorage: true,               // default for the start-of-pass reset choice
  viewport: { width: 1920, height: 1080 },
  headerStrip: true,                // strip X-Frame-Options / frame-ancestors so the app frames

  // Browser permissions granted up front so a native prompt never blocks the run:
  permissions: ["geolocation", "clipboard-read", "clipboard-write"], // allow-all by default
  geolocation: undefined,           // { latitude, longitude } — fixed & deterministic
};
```

| Field | Default | Notes |
| --- | --- | --- |
| `devCommand` | — | Command that starts your dev server. `$PORT` is set for you. |
| `url` | — | Where the app answers once ready. `{port}` is replaced. |
| `cwd` | `"."` | Frontend directory relative to the repo root. |
| `readyTimeout` | `60000` | How long to wait for `url` to respond. |
| `externalUrl` | — | Use an app you already run instead of a managed dev server. Same as `run --url`. |
| `baseBranch` | auto | Override PR-base detection. Same as `run --base`. |
| `keepWorktree` | `false` | Reuse the base worktree across runs. Same as `run --keep-worktree`. |
| `format` | `"mp4"` | `mp4` \| `gif` \| `both`. |
| `passes` | `2` | `2` = before/after comparison; `1` = single standalone clip. `run --single` forces 1. |
| `resetStorage` | `true` | Default for the start-of-pass reset choice (clear cookies/storage vs. keep your session). |
| `viewport` | `1920×1080` | Logical app resolution; the window scales to fit. |
| `headerStrip` | `true` | Strip only frame-busting headers so the app loads in the iframe. |
| `permissions` | allow-all | Browser permissions to grant (Playwright names). Unlisted ones stay denied — no native prompt blocks the run. |
| `geolocation` | — | Fixed `{ latitude, longitude }` so location apps render identical results in both clips. |

## CLI

| Command | What it does |
| --- | --- |
| `pr-preview init` | Scaffold `pr-preview.config.js`, a `.gitignore` entry, `.mcp.json`, and the `/record` Claude Code skill. |
| `pr-preview record` | Record a journey on the current branch only (`-o <file>`). |
| `pr-preview run` | The full before/after flow. |
| `pr-preview mcp` | Run the MCP server (stdio) so Claude Code can drive a recording. |

`run` flags: `-b, --base <ref>` (override base) · `--keep-worktree` (reuse the base worktree) ·
`-u, --url <url>` (use your own running app) · `-s, --single` (one standalone clip, no comparison).

### Bring your own running app (`--url`)

For apps that can't boot in a throwaway checkout (need `.env`, a backend, a database), run the app
yourself and point PR Preview at it:

```bash
npm run dev                                   # → http://localhost:3000 (base branch)
npx pr-preview run --url http://localhost:3000
```

It records BEFORE on your running app, then **pauses** — you switch branches, restart on the same
URL, and click **Continue** — then it records AFTER. No worktree, no managed dev server.

## Use it from Claude Code

PR Preview ships an **MCP server** so Claude Code can record a journey for you — you describe the
flow in plain English and Claude drives your real app in Chrome, records it, and (optionally) opens
the PR. It's agent-driven, but still a real capture of your real app; nothing is synthesized.

**Setup** — `npx pr-preview init` writes a `.mcp.json` that registers the server:

```json
{ "mcpServers": { "pr-preview": { "command": "npx", "args": ["pr-preview", "mcp"] } } }
```

Open the project in Claude Code (it auto-discovers `.mcp.json`) and just ask:

> **You:** Record my add-to-cart flow — add 3 books to the cart, then go to checkout. Then open the PR.
>
> **Claude:** *opens Chrome, performs each step live, renders `before.mp4` + `after.mp4`, and opens
> the pull request with the clip embedded.*

**The tools Claude uses:**

| Tool | What it does |
| --- | --- |
| `start_recording` | Open the app + start recording. `mode: "single"` (one clip) or `"before-after"`. Omit `url` to start your dev server; pass one to record an app you already run. |
| `snapshot` | Read the page as an accessibility tree with `[ref=eN]` handles. |
| `act` | Perform one action: `click` / `fill` / `press` / `hover` / `navigate` / `scroll` / `wait`. |
| `next_pass` | *(before-after)* finish the BEFORE clip, switch to your branch, start AFTER. |
| `finish_recording` | Stop, encode, and return the clip path(s). |
| `open_pr` | Commit the clip, push the branch, and open a PR with the preview embedded. |
| `detect_localhost` | Probe common dev-server ports and report which local apps are running (with their page titles). |
| `cancel_recording` | Abort and close the browser without producing a clip. |

Claude targets elements by their accessible name (no selectors or scripts), so it works on any app.

**No URL? Claude asks — it never guesses.** If you don't name a URL, Claude runs `detect_localhost`
first: if apps are running it asks which one to record; if none are, it asks for a local, staging, or
production URL. That way it always records the app you meant.

**The `/record` slash command.** `init` also installs a Claude Code skill at
`.claude/skills/record/SKILL.md`, so you can record any flow in one line:

```
/record localhost:3000 add a book to the cart, then checkout
```

The skill drives the recording through the MCP tools above (agent mode), resolving the URL the same
way. It's non-destructive — `init` skips it if the file already exists.

**Before/after in agent mode** needs a managed dev server (omit `url`) and for you to be on a PR
branch: Claude records the journey on the base branch (in a git worktree), then redoes the *same*
journey on your branch. `--url` / already-running apps stay single-clip in agent mode, since an
external app can't be branch-swapped without you.

**About `open_pr`:** GitHub only plays inline video from its own attachment CDN (no public API), so
the open-source path embeds an animated **GIF** (rendered inline) and links the full MP4. It creates
a commit on your branch and pushes it, and needs the [GitHub CLI](https://cli.github.com) (`gh`)
authenticated. One-click *hosted video in the PR body* is part of PR Preview for Teams.

**Prefer to record by hand?** Manual mode is unchanged: `npx pr-preview run` opens Chrome for you to
click through yourself. Both modes produce the same clips — the only difference is whose hands drive.

## Privacy

PR Preview runs locally — it opens your app in a Chrome window, records, and writes video files to
your project. Nothing is uploaded. The clip is a real screen recording, so avoid typing real
production secrets on camera (use a test login, or your own redaction).

## Requirements

- **Node.js ≥ 20**
- **Chromium** via Playwright (`npx playwright install chromium`)
- **ffmpeg** (optional) for MP4 output

## Limitations

PR Preview drives a real app inside a controlled browser, so a few things are out of scope:

- **In-iframe SSO** (e.g. a redirect-style "Sign in with Google") — providers refuse to be framed.
  Log in by hand before recording and keep the session; popup-based OAuth usually works.
- **CAPTCHA** — complete it by hand.
- **Canvas/WebGL, closed shadow roots, nested third-party iframes** (Stripe Elements, embedded
  checkout) — limited support.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome — and a star helps a lot.

## License & what's free

The **CLI is open source under the [MIT license](./LICENSE)** — free to use, including commercially.
This is an open-core project:

- **This CLI** — recording and before/after clip generation. MIT, free forever. Clips carry a
  small `pr-preview.com` watermark.
- **PR Preview for Teams** ([pr-preview.com](https://pr-preview.com)) — the hosted service:
  clip hosting, a synced review player, team reviewers & comments, sharing, and watermark-free
  clips. A separate, proprietary commercial offering — *coming soon*.
- The **"PR Preview" name and logo** are trademarks of SC QWERTYBIT SRL; the MIT license covers
  the code, not the brand.

---

<p align="center">
  <a href="https://pr-preview.com"><strong>pr-preview.com</strong></a><br/>
  <sub>See it in action, and <a href="https://pr-preview.com/#teams">join the early-access list for PR&nbsp;Preview for Teams</a> —<br/>
  hosted clips, team reviews &amp; sharing, coming soon.</sub>
</p>

<p align="center"><sub>Built by <a href="https://qwertybit.com">QwertyBit</a> · Free &amp; Open Source · MIT</sub></p>
