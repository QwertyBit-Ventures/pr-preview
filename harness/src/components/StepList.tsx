import type { ClientMessage, Phase, StepSummary } from "../../../src/ipc/protocol.js";
import { Icon, type IconName } from "./Icon.js";

interface Props {
  steps: StepSummary[];
  phase: Phase;
  send: (msg: ClientMessage) => void;
}

const TYPE_ICON: Record<StepSummary["type"], IconName> = {
  click: "click",
  fill: "type",
  select: "navigate",
  press: "key",
  scroll: "scroll",
  navigate: "navigate",
  wait: "clock",
};

/** Outline of the recorded journey — a thumbnail per action, with re-record
 *  and delete. (Purely a visual outline; the clip is the live footage.) */
export function StepList({ steps, phase, send }: Props) {
  const editable = phase === "idle" || phase === "recording";

  if (steps.length === 0) {
    return <div class="steps steps--empty">No steps yet</div>;
  }

  return (
    <ol class="steps">
      {steps.map((step, i) => (
        <li key={step.id} class="step">
          {step.thumbnail ? (
            <img class="step-thumb" src={step.thumbnail} alt="" />
          ) : (
            <div class="step-thumb step-thumb--blank">
              <Icon name={TYPE_ICON[step.type]} />
            </div>
          )}
          <div class="step-body">
            <span class="step-index">{i + 1}</span>
            <span class="step-type">
              <Icon name={TYPE_ICON[step.type]} />
            </span>
            <span class="step-label" title={step.label}>
              {step.label}
            </span>
            {editable && (
              <span class="step-actions">
                <button
                  class="icon-btn"
                  title="Re-record from this step"
                  onClick={() => send({ type: "RERECORD_FROM", stepId: step.id })}
                >
                  <Icon name="retry" />
                </button>
                <button
                  class="icon-btn icon-btn--danger"
                  title="Delete step"
                  onClick={() => send({ type: "DELETE_STEP", stepId: step.id })}
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
