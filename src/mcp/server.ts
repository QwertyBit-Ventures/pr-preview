import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { PreviewRecorder, type ActInput } from "./recorder.js";
import { openPr } from "./publish.js";
import { detectLocalApps, type LocalApp } from "./detect.js";
import { loadConfig } from "../config/load.js";

/** Message that pushes the agent to confirm a URL with the user instead of guessing. */
function urlAsk(found: LocalApp[], hasConfig: boolean): string {
  const lines = ["No URL was specified — I won't guess which app to record."];
  if (found.length) {
    lines.push("", "Apps currently running on localhost:");
    for (const f of found) lines.push(`- ${f.url}${f.title ? ` — ${f.title}` : ""}`);
    lines.push("", "Ask the user which of these to record (confirm the exact URL), then call start_recording again with that `url`.");
  } else {
    lines.push(
      "",
      "Nothing is responding on common localhost ports — the project may not be running locally.",
      "Ask the user for the URL to record: their local dev server URL, or a staging / production URL. Then call start_recording with that `url`.",
    );
  }
  if (hasConfig) {
    lines.push(
      "",
      "Alternatively, if the user wants PR Preview to start the project's own dev server (from pr-preview.config.js), call start_recording with `useDevServer: true`.",
    );
  }
  return lines.join("\n");
}

/**
 * Start the PR Preview MCP server on stdio. Exposes a small tool surface that
 * lets an agent (Claude Code) record a real journey through the user's app and
 * produce a before/after-style video clip — the agent chooses the actions, the
 * existing engine captures the live session, so nothing is synthesized.
 *
 * Resolves when the client disconnects (stdio transport closes).
 */
export async function startMcpServer(repoRoot: string): Promise<void> {
  const recorder = new PreviewRecorder(repoRoot);

  const server = new McpServer({
    name: "pr-preview",
    version: "0.1.0",
  });

  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
  const fail = (e: unknown) => ({
    content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  });

  const SNAPSHOT_HINT =
    "\n\nEach line is an element with a [ref=eN] handle. To act on one, call `act` " +
    "with that ref. Always take a fresh snapshot after any action that changes the " +
    "page (refs are only valid for the most recent snapshot).";

  server.tool(
    "detect_localhost",
    "Probe common localhost ports and list the apps currently running. Use this when the " +
      "user hasn't given a URL, to offer them the running app(s) to record.",
    {},
    async () => {
      try {
        const found = await detectLocalApps();
        if (!found.length) {
          return text(
            "No app is responding on common localhost ports. Ask the user for a URL to record — " +
              "their local dev server, or a staging / production URL.",
          );
        }
        return text(
          "Apps running on localhost:\n" +
            found.map((f) => `- ${f.url}${f.title ? ` — ${f.title}` : ""}`).join("\n") +
            "\n\nAsk the user which one to record, then call start_recording with that url.",
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "start_recording",
    "Open the user's app in the PR Preview harness — a real, VISIBLE Chrome window where the " +
      "app runs inside the harness iframe and the sidebar records each step — and begin recording. " +
      "Returns the app's accessibility snapshot so you can pick the first action.\n\n" +
      "URL handling — do NOT guess: if the user gave a URL, pass it as `url`. If they did NOT " +
      "specify one, call this with no `url`; it detects apps on localhost and returns them so you " +
      "can ASK the user which URL to record. If nothing is running locally, ask the user for a " +
      "staging or production URL. Only pass `useDevServer: true` when the user explicitly wants " +
      "PR Preview to start the project's own dev server (from pr-preview.config.js).\n\n" +
      "mode 'single' (default) records one clip. mode 'before-after' records the SAME journey " +
      "twice — first on the PR's base branch, then on your branch — for a true before/after (uses a " +
      "managed dev server and requires being on a git branch; `url` is ignored). In before-after " +
      "mode: drive the journey with `act`, call `next_pass`, redo the SAME journey, then finish.",
    {
      url: z.string().optional().describe("URL of an already-running app to record (ask the user if unsure)"),
      mode: z.enum(["single", "before-after"]).optional(),
      useDevServer: z
        .boolean()
        .optional()
        .describe("Start the project's own dev server from pr-preview.config.js instead of using a URL"),
    },
    async ({ url, mode, useDevServer }) => {
      try {
        const m = mode ?? "single";
        // No URL, no explicit dev-server request → detect + ask rather than guess.
        if (m === "single" && !url && !useDevServer) {
          const found = await detectLocalApps();
          let hasConfig = false;
          try {
            await loadConfig(repoRoot);
            hasConfig = true;
          } catch {
            /* no config — dev-server path unavailable */
          }
          return text(urlAsk(found, hasConfig));
        }
        const r = await recorder.start({ url, mode });
        const win =
          "A Chrome window has opened with the PR Preview harness — the app is running in the iframe and the sidebar records each step.";
        const hint =
          r.mode === "before-after"
            ? "\n\nThis is the BEFORE pass (base branch). Perform the journey, then call `next_pass`."
            : "";
        return text(`${win}\nRecording started at ${r.startUrl}. Current page:\n\n${r.snapshot}${SNAPSHOT_HINT}${hint}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "next_pass",
    "before-after mode only: finish the BEFORE clip, switch the app to your branch, and " +
      "begin the AFTER recording. After calling this, redo the SAME journey with `act`, " +
      "then call `finish_recording`.",
    {},
    async () => {
      try {
        const { snapshot } = await recorder.nextPass();
        return text(
          `BEFORE clip captured. Now recording the AFTER pass (your branch) — redo the same journey.\n\n${snapshot}${SNAPSHOT_HINT}`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "snapshot",
    "Return the current accessibility snapshot of the app (elements with [ref=eN] " +
      "handles). Use this to see the page before choosing the next action.",
    {},
    async () => {
      try {
        return text((await recorder.snapshot()) + SNAPSHOT_HINT);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "act",
    "Perform one action in the app, then return the fresh snapshot. Actions: " +
      "`click` (ref), `fill` (ref + text), `press` (ref + key, e.g. Enter), `hover` (ref), " +
      "`navigate` (url or path), `scroll` (optional ref to scroll into view), `wait` (ms). " +
      "The action is recorded into the live clip.",
    {
      action: z.enum(["click", "fill", "press", "hover", "navigate", "scroll", "wait"]),
      ref: z.string().optional().describe("Element ref from the latest snapshot, e.g. e14"),
      text: z.string().optional().describe("Text to type (for fill)"),
      key: z.string().optional().describe("Key to press, e.g. Enter (for press)"),
      url: z.string().optional().describe("URL or path (for navigate)"),
      ms: z.number().optional().describe("Milliseconds to pause (for wait)"),
    },
    async (args) => {
      try {
        const { snapshot } = await recorder.act(args as ActInput);
        return text(`Done: ${args.action}. Current page:\n\n${snapshot}${SNAPSHOT_HINT}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "finish_recording",
    "Stop recording, encode the clip, and return the output file path(s). Call this " +
      "when the journey is complete. `name` optionally sets the output filename.",
    { name: z.string().optional() },
    async ({ name }) => {
      try {
        const { files, fellBackToGif } = await recorder.finish({ name });
        const rel = files.map((f) => path.relative(repoRoot, f));
        const note = fellBackToGif
          ? "\n(ffmpeg was not found, so a GIF was produced instead of MP4 — `brew install ffmpeg` for MP4.)"
          : "";
        return text(
          `Recording complete. Output:\n${rel.map((r) => `  - ${r}`).join("\n")}${note}\n\n` +
            "Drag the file into your PR description to embed it, or commit it and open the PR.",
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "open_pr",
    "Commit the recorded clip into the repo, push the current branch, and open a pull " +
      "request with the preview embedded in the body. Pass the file path(s) returned by " +
      "finish_recording. Requires the GitHub CLI (gh) authenticated and an `origin` remote. " +
      "Note: GitHub only plays inline video from its own CDN, so this embeds an animated GIF " +
      "(rendered inline) and links the full MP4. Side effects: it creates a commit on your " +
      "branch and pushes it.",
    {
      files: z.array(z.string()).describe("Clip file path(s) from finish_recording"),
      title: z.string().optional().describe("PR title (defaults to 'Preview: <branch>')"),
      base: z.string().optional().describe("Base branch for the PR (e.g. main)"),
    },
    async ({ files, title, base }) => {
      try {
        const { prUrl, committed, embedded } = await openPr(repoRoot, files, { title, base });
        const how = embedded === "gif" ? "an inline GIF preview" : "a link to the MP4";
        return text(
          `Pull request opened: ${prUrl}\nCommitted ${committed.length} file(s) under pr-preview/ and embedded ${how}.`,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "cancel_recording",
    "Abort the current recording and close the browser without producing a clip.",
    {},
    async () => {
      try {
        await recorder.dispose();
        return text("Recording cancelled — browser closed, no clip produced.");
      } catch (e) {
        return fail(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the client disconnects; then clean up.
  await new Promise<void>((resolve) => {
    transport.onclose = () => {
      void recorder.dispose().finally(resolve);
    };
  });
}
