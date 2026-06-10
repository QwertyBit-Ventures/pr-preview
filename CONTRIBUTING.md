# Contributing to pr-preview

Thanks for your interest! pr-preview is MIT-licensed and contributions are
welcome.

## Getting started

```bash
git clone https://github.com/QwertyBit-Ventures/pr-preview.git
cd pr-preview
npm install
npx playwright install chromium   # one-time browser download
npm run build
```

## Project layout

| Path | What it is |
| --- | --- |
| `src/cli/` | Commander CLI (`init` / `record` / `run`) |
| `src/browser/` | Playwright launch, iframe resolution, recorder injection, header strip |
| `src/recorder/` | In-page recorder (browser IIFE) + step normalization + journey schema |
| `src/replay/` | Selector-fallback replay, pacing, synthetic cursor |
| `src/capture/` | CDP screencast + frame resampling |
| `src/encode/` | MP4 (ffmpeg) + GIF (gifenc) encoders, burned-in caption |
| `src/session/` | The interactive state machine tying it all together |
| `harness/` | The sidebar UI (Vite + Preact) |
| `examples/vite-react-todo/` | Fixture app used by the E2E tests |

Two build targets: `tsup` bundles the Node CLI + the in-page recorder IIFE;
Vite builds the harness SPA into `dist/harness`.

## Tests

```bash
npm run typecheck     # tsc --noEmit
npm test              # unit tests (fast)
npm run test:e2e      # full-stack E2E (spawns the example app, headless Chrome)
```

The E2E suite runs headless via `PR_PREVIEW_HEADLESS=1` and exercises the real
record → replay → encode pipeline, including selector-drift handling against a
throwaway git repo.

`test/e2e/dynamic.test.ts` runs the replay engine against `examples/dynamic-app`
(a deliberately unreliable fixture: latency, loading spinners, fetch-loaded
content, 2FA, transient detaches, OAuth popups). Add `PR_PREVIEW_THROTTLE=1` to
re-run those scenarios under real (CDP) network latency.

## Before opening a PR

1. `npm run typecheck` is clean.
2. `npm test` and `npm run test:e2e` pass.
3. `npm run build` succeeds.

For UI-facing changes, a `pr-preview run` clip in the PR description is, fittingly, very welcome.
