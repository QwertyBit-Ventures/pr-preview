import type { Phase } from "../../../src/ipc/protocol.js";

interface Props {
  phase: Phase;
  detail?: string;
  pause: { label: string } | null;
  outputs: { before?: string; after?: string } | null;
  error: string | null;
}

export function StatusBar({ phase, detail, pause, outputs, error }: Props) {
  // The Continue button lives in the bottom ActionBar; this panel explains.
  if (pause) {
    return (
      <div class="status status--pause">
        <strong>Your turn</strong>
        <p>{pause.label}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div class="status status--failed">
        <strong>Error</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (phase === "done" && outputs) {
    return (
      <div class="status status--done">
        <strong>All done — your clips are ready</strong>
        {outputs.before && <p class="mono">{outputs.before}</p>}
        {outputs.after && <p class="mono">{outputs.after}</p>}
        <p>The output folder just opened. You can close this window.</p>
      </div>
    );
  }

  if (detail) {
    return (
      <div class="status">
        <p>{detail}</p>
      </div>
    );
  }

  // Idle/recording guidance lives in <Prompt>.
  return null;
}
