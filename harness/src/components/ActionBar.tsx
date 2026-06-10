import type { ClientMessage, Phase } from "../../../src/ipc/protocol.js";
import { Icon } from "./Icon.js";

interface Props {
  phase: Phase;
  pass: "before" | "after";
  hasSteps: boolean;
  pause: { label: string } | null;
  send: (msg: ClientMessage) => void;
}

/**
 * The one place progression actions live — pinned to the bottom of the
 * sidebar so "what do I click next?" always has the same answer.
 */
export function ActionBar({ phase, pass, hasSteps, pause, send }: Props) {
  // A hands-off prompt (e.g. switch branches in --url mode): the user acts in
  // the app, then continues from here.
  if (pause) {
    return (
      <div class="actionbar">
        <button class="btn btn--confirm" onClick={() => send({ type: "CONTINUE" })}>
          Continue <Icon name="arrowRight" />
        </button>
      </div>
    );
  }

  if (phase === "recording") {
    return (
      <div class="actionbar">
        <button class="btn btn--stop" onClick={() => send({ type: "STOP_RECORD" })}>
          <Icon name="stop" /> Stop recording
        </button>
      </div>
    );
  }

  if (phase !== "idle") return null; // encoding / done run on their own

  if (!hasSteps) {
    return (
      <div class="actionbar">
        <button class="btn btn--rec" onClick={() => send({ type: "START_RECORD" })}>
          <Icon name="record" /> Start recording
        </button>
        {pass === "after" && (
          <button class="btn btn--ghost" onClick={() => send({ type: "LOAD_BEFORE_STEPS" })}>
            <Icon name="loadBefore" /> Load BEFORE steps
          </button>
        )}
      </div>
    );
  }

  return (
    <div class="actionbar">
      <button class="btn btn--confirm" onClick={() => send({ type: "CONFIRM" })}>
        <Icon name="check" />
        {pass === "after" ? " Save — capture AFTER clip" : " Confirm — capture clip"}
      </button>
      <div class="actionbar-row">
        <button class="btn btn--ghost" onClick={() => send({ type: "START_RECORD" })}>
          <Icon name="record" /> Record more
        </button>
      </div>
    </div>
  );
}
