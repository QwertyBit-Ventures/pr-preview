import type { ClientMessage, PassInfo, Phase } from "../../../src/ipc/protocol.js";

interface Props {
  phase: Phase;
  passInfo: PassInfo;
  hasSteps: boolean;
  send: (msg: ClientMessage) => void;
}

/** Step-by-step guidance for the current pass — what to do, right now. */
export function Prompt({ phase, passInfo, hasSteps, send }: Props) {
  if (phase !== "idle" && phase !== "recording") return null;
  const { pass, branches } = passInfo;
  const branch = branches ? branches[pass] : null;
  const passLabel = branches ? `${pass.toUpperCase()}${branch ? ` (${branch})` : ""}` : "";

  if (phase === "recording") {
    return (
      <div class="status status--hint">
        <p>
          Recording{branches ? ` on ${passLabel}` : ""} — use the app on the left. Every click,
          keystroke and scroll becomes a step. Hit <strong>Stop recording</strong> when the journey
          is done.
        </p>
      </div>
    );
  }

  if (!hasSteps) {
    return (
      <div class="status status--hint">
        {branches ? (
          pass === "before" ? (
            <p>
              <strong>{passLabel}</strong> — the app before your PR. Click{" "}
              <strong>Start recording</strong> when you're ready, then perform the journey you want
              to showcase. Confirming moves on to step 2 (recording the BEFORE clip).
            </p>
          ) : (
            <p>
              <strong>{passLabel}</strong> — the app with your changes. The UI may differ from
              BEFORE, so create the steps again — or load the BEFORE steps and adjust. Saving moves
              on to step 4 (recording the AFTER clip).
            </p>
          )
        ) : (
          <p>
            Click <strong>Start recording</strong> when you're ready, then use the app on the left.
          </p>
        )}
      </div>
    );
  }

  return (
    <div class="status status--hint">
      <p>
        Review the steps below — click a step to re-record from that point, or delete it. Then{" "}
        <strong>{pass === "after" ? "Save" : "Confirm"}</strong> to capture
        {branches ? ` ${pass.toUpperCase()}` : ""}.
      </p>
    </div>
  );
}
