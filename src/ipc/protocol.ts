/**
 * Shared message types between the Node CLI process (hub) and the
 * harness sidebar SPA (view). Pure types + JSON — imported by both builds.
 *
 * Flow of events:
 *   iframe recorder --exposeBinding--> Node --WS--> sidebar
 *   sidebar --WS--> Node --Playwright--> browser
 */

import type { Step } from "../recorder/types.js";

export type Phase = "idle" | "recording" | "encoding" | "done";

/** Which pass the session is on, with branch labels for the tab strip. */
export interface PassInfo {
  pass: "before" | "after";
  /** Branch/ref labels; absent in single-pass `record` mode (tabs hidden). */
  branches?: { before: string; after: string };
  /** Which GIFs are already finished (ticks the tabs). */
  done: { before: boolean; after: boolean };
  /** Whether this pass's clip starts from a cleared app (true) or keeps the
   *  signed-in state captured when recording began (false). User-toggleable. */
  resetStorage: boolean;
  /** Recordings planned this session: 2 = before/after wizard, 1 = a single
   *  standalone clip. Undefined in the `record` command (no clips). Drives how
   *  the harness wizard/tabs render. */
  passes?: 1 | 2;
}

/** Node → sidebar */
export type ServerMessage =
  | {
      type: "HELLO";
      phase: Phase;
      steps: StepSummary[];
      appUrl: string;
      mode: "record" | "run";
      passInfo: PassInfo;
    }
  | { type: "PASS_CHANGED"; passInfo: PassInfo }
  | { type: "PHASE_CHANGED"; phase: Phase; detail?: string }
  | { type: "STEP_ADDED"; step: StepSummary }
  | { type: "STEP_UPDATED"; step: StepSummary }
  | { type: "STEP_REMOVED"; stepId: string }
  | { type: "STEPS_RESET"; steps: StepSummary[] }
  | { type: "ENCODE_PROGRESS"; which: "before" | "after"; stage: string; done: number; total: number }
  /** A hands-off prompt (e.g. "switch your app to the PR branch, then Continue"
   *  in --url mode). The user acts in the app, then hits Continue. */
  | { type: "MANUAL_PAUSE"; stepId: string | null; label: string; kind: "generic" }
  | { type: "GIF_READY"; which: "before" | "after"; path: string }
  | { type: "DONE"; outputs: { before?: string; after?: string } }
  /** Blocking nudge at the start of a pass: reset the app or keep the session,
   *  before recording. `defaultReset` seeds the highlighted choice. */
  | { type: "RESET_PROMPT"; pass: "before" | "after"; defaultReset: boolean }
  | { type: "ERROR"; message: string };

/** Sidebar → Node */
export type ClientMessage =
  | { type: "START_RECORD" }
  | { type: "STOP_RECORD" }
  | { type: "CONFIRM" }
  | { type: "DELETE_STEP"; stepId: string }
  | { type: "RERECORD_FROM"; stepId: string }
  | { type: "CONTINUE" }
  | { type: "LOAD_BEFORE_STEPS" }
  /** Answer to RESET_PROMPT: start the pass fresh (true) or keep the session. */
  | { type: "RESET_CHOICE"; reset: boolean }
  /** Manually reload the app inside the iframe (refresh button). */
  | { type: "RELOAD_IFRAME" }
  | { type: "ABORT" };

/** What the sidebar needs to render a step row. */
export interface StepSummary {
  id: string;
  type: Step["type"];
  label: string;
  thumbnail?: string; // small data-URL png
}

export function serialize(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg === "object" && msg !== null && typeof msg.type === "string") {
      return msg as ClientMessage;
    }
  } catch {
    /* malformed frame — drop */
  }
  return null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg === "object" && msg !== null && typeof msg.type === "string") {
      return msg as ServerMessage;
    }
  } catch {
    /* malformed frame — drop */
  }
  return null;
}
