import type { Phase } from "../../../src/ipc/protocol.js";

export interface Progress {
  label: string;
  done: number;
  total: number;
}

/**
 * Prominent determinate progress shown while the clip encodes. Indeterminate
 * (animated) when totals aren't known yet.
 */
export function ProgressBar({ phase, progress }: { phase: Phase; progress: Progress | null }) {
  if (phase !== "encoding") return null;

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  const label = progress?.label ?? "Encoding…";

  return (
    <div class="progress">
      <div class="progress-head">
        <span class="progress-label">{label}</span>
        {pct !== null && <span class="progress-pct">{pct}%</span>}
      </div>
      <div class="progress-track">
        <div
          class={`progress-fill ${pct === null ? "progress-fill--indeterminate" : ""}`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {progress && progress.total > 0 && (
        <div class="progress-sub">
          {progress.done} / {progress.total}
        </div>
      )}
    </div>
  );
}
