import type { PageCheck } from "../App.js";

const WHICH_LABEL = { before: "BEFORE", after: "AFTER", preview: "preview" } as const;

/**
 * Pre-capture readiness check: the app must be on the journey's start page
 * before the simulation begins. While it isn't (login wall, redirect), the
 * user is prompted to act inside the iframe; the moment the page matches,
 * the capture starts by itself — green tick, no extra click.
 */
export function ReadyGate({ check }: { check: PageCheck | null }) {
  if (!check) {
    return (
      <div class="status gate">
        <strong>Loading the start page …</strong>
      </div>
    );
  }

  return (
    <div class={`status gate ${check.ok ? "gate--ok" : "gate--waiting"}`}>
      <strong>Ready check — {WHICH_LABEL[check.which]} pass</strong>
      <div class="gate-row">
        <span class={`gate-tick ${check.ok ? "gate-tick--ok" : ""}`}>{check.ok ? "✓" : "…"}</span>
        <span>
          Journey starts on <code>{check.expectedPath}</code>
          {!check.ok && (
            <>
              {" — app is on "}
              <code>{check.currentPath}</code>
            </>
          )}
        </span>
      </div>
      <p>
        {check.ok
          ? "Page matches — hands off the mouse, capture is starting…"
          : "Use the app on the left to get there (complete the login, dismiss dialogs, navigate). Capture starts on its own once the page matches."}
      </p>
    </div>
  );
}
