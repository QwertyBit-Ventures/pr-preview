import type { PassInfo, Phase } from "../../../src/ipc/protocol.js";
import { Icon } from "./Icon.js";

const DUAL_STAGES = [
  "Create BEFORE steps",
  "Record BEFORE clip",
  "Create AFTER steps",
  "Record AFTER clip",
  "Generate files",
] as const;

const SINGLE_STAGES = ["Record the journey", "Generate the clip"] as const;

/** Map (pass, phase) onto the before/after pipeline. Returns 5 when all done. */
function dualIndex(passInfo: PassInfo, phase: Phase): number {
  if (phase === "done") return 5;
  if (passInfo.pass === "before") return phase === "encoding" ? 1 : 0;
  return phase === "encoding" ? 4 : 2;
}

/** Map phase onto the single-clip pipeline. Returns 2 when done. */
function singleIndex(phase: Phase): number {
  if (phase === "done") return 2;
  return phase === "encoding" ? 1 : 0;
}

/** Wizard progress for the planned run (single clip or before/after). */
export function Stepper({ passInfo, phase }: { passInfo: PassInfo; phase: Phase }) {
  if (passInfo.passes == null) return null; // `record` command — no clip wizard
  const single = passInfo.passes === 1;
  const STAGES = single ? SINGLE_STAGES : DUAL_STAGES;
  const total = STAGES.length;
  const current = single ? singleIndex(phase) : dualIndex(passInfo, phase);

  return (
    <div class="stepper">
      <div class="stepper-track">
        {STAGES.map((label, i) => (
          <>
            {i > 0 && <span class={`stepper-line ${i <= current ? "stepper-line--done" : ""}`} />}
            <span
              class={`stepper-dot ${
                i < current ? "stepper-dot--done" : i === current ? "stepper-dot--current" : ""
              }`}
              title={label}
            >
              {i < current ? <Icon name="check" /> : i + 1}
            </span>
          </>
        ))}
      </div>
      <div class="stepper-label">
        {current >= total ? (
          <strong>All {total} steps complete</strong>
        ) : (
          <>
            Step <strong>{current + 1} of {total}</strong> — {STAGES[current]}
          </>
        )}
      </div>
    </div>
  );
}
