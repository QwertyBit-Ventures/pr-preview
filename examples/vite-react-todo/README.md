# vite-react-todo — pr-preview example & fixture

A tiny Vite + React app (fake login → todo list, with client-side routing)
used as the fixture for [`@qwertybit/pr-preview`](../../README.md)'s tests and
as a playground for trying the tool.

```bash
npm install
npm run dev
```

It ships a `pr-preview.config.js`, so from this directory you can run:

```bash
npx @qwertybit/pr-preview run
```

Notes for the test suite:

- `?xfo=1` on any URL makes the dev server send `X-Frame-Options: DENY` +
  CSP `frame-ancestors 'none'`, exercising pr-preview's header-strip path.
- The E2E "drift" test creates a throwaway git repo from this app and renames
  the Add button's `data-testid` on a branch to verify selector-drift handling.
