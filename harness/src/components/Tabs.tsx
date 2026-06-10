import type { PassInfo } from "../../../src/ipc/protocol.js";
import { Icon } from "./Icon.js";

/**
 * BEFORE/AFTER tab strip with branch names. Informational — the active pass
 * is driven by the run flow, not clickable. A tick marks a finished clip.
 */
export function Tabs({ passInfo }: { passInfo: PassInfo }) {
  if (!passInfo.branches) return null; // single-pass `record` mode

  const tab = (which: "before" | "after", branch: string) => {
    const active = passInfo.pass === which;
    const done = passInfo.done[which];
    return (
      <div class={`tab ${active ? "tab--active" : ""} ${done ? "tab--done" : ""}`}>
        <span class="tab-state">
          {done ? <Icon name="check" /> : <span class={`tab-bullet ${active ? "tab-bullet--on" : ""}`} />}
        </span>
        <span class="tab-name">{which.toUpperCase()}</span>
        <span class="tab-branch" title={branch}>
          {branch}
        </span>
      </div>
    );
  };

  return (
    <nav class="tabs">
      {tab("before", passInfo.branches.before)}
      <span class="tabs-arrow">
        <Icon name="arrowRight" />
      </span>
      {tab("after", passInfo.branches.after)}
    </nav>
  );
}
