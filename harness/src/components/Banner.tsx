import type { Phase } from "../../../src/ipc/protocol.js";
import { Logo } from "./Logo.js";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  recording: "Recording your journey",
  encoding: "Encoding clip",
  done: "Done",
};

export function Banner({ phase }: { phase: Phase }) {
  const active = phase !== "idle" && phase !== "done";
  return (
    <header class="banner">
      <Logo />
      <span class="banner-status">
        {active && <span class={`dot ${phase === "recording" ? "dot--rec" : "dot--sim"}`} />}
        {PHASE_LABEL[phase]}
      </span>
    </header>
  );
}
