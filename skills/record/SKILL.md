---
name: record
description: Record a video of a user journey through a web app, automatically, using PR Preview (@qwertybit/pr-preview). Claude drives the app itself and produces an MP4 — no human clicking. Usage: /record [url] [journey in plain English]. Use when the user wants to record, film, or capture a walkthrough or before/after video of an app for a pull request or demo.
---

# /record — record an app journey automatically with PR Preview

You record a real video walkthrough of a web app by **driving it yourself** through the
PR Preview MCP server — not by asking the user to click. PR Preview opens its harness (a
visible Chrome window with the app in an iframe and a step sidebar); you perform the
journey through its tools and it captures a clean, PR-ready MP4.

## Arguments
`/record [url] [journey]`
- **url** (optional): the app to record, e.g. `http://localhost:3000` or `https://staging.example.com`. The first URL-looking token is the URL; the rest is the journey.
- **journey** (optional): what to do, in plain English (e.g. "add 3 books to the cart, then go to checkout").

## Preconditions
The PR Preview MCP tools must be connected: `start_recording`, `snapshot`, `act`,
`next_pass`, `finish_recording`, `open_pr`, `detect_localhost`.
- If they are NOT available, tell the user to install and connect it:
  `npm i -D @qwertybit/pr-preview` → `npx pr-preview init` (writes `.mcp.json`) → reload Claude Code.
  Stop until it's connected.

## Steps
1. **Resolve the URL.** If a URL was given, use it. Otherwise call `detect_localhost`; if apps
   are running, ask the user which to record; if none are, ask for a local, staging, or
   production URL. **Never guess.**
2. **Start.** Call `start_recording` with `{ url }`. A Chrome window opens with the harness —
   the app runs in the iframe and the sidebar records each step. Do NOT click "Start recording";
   `start_recording` already began it. (For a base-vs-branch PR comparison, use
   `{ mode: "before-after" }` with a managed dev server instead.)
3. **Drive the journey.** Read the returned accessibility snapshot. For each step in the journey,
   call `act` (`click` / `fill` / `press` / `hover` / `navigate` / `scroll`), targeting elements
   by their `[ref=…]` handle. Take a fresh snapshot after any step that changes the page. Perform
   the journey faithfully — **you drive it; never ask the user to click.**
4. **Finish.** Call `finish_recording` and report the output MP4 path.
5. **PR (optional).** If the user asked, call `open_pr` with the produced file(s).

## Important
- This is agent-driven but a REAL capture of the real app — nothing is synthesized.
- Do NOT use the `pr-preview run` CLI for this — that is the manual, human-in-the-loop flow that
  waits for a person to click. Always drive via the MCP tools above so recording is automatic.
