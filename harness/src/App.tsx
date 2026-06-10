import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PassInfo, Phase, ServerMessage, StepSummary } from "../../src/ipc/protocol.js";
import { connect } from "./ws.js";
import { Banner } from "./components/Banner.js";
import { StepList } from "./components/StepList.js";
import { ActionBar } from "./components/ActionBar.js";
import { StatusBar } from "./components/StatusBar.js";
import { Tabs } from "./components/Tabs.js";
import { Prompt } from "./components/Prompt.js";
import { ResetPopup } from "./components/ResetPopup.js";
import { Stepper } from "./components/Stepper.js";
import { Footer } from "./components/Footer.js";
import { ProgressBar, type Progress } from "./components/ProgressBar.js";
import { PausePopup } from "./components/PausePopup.js";
import { Icon } from "./components/Icon.js";

interface Runtime {
  appUrl: string;
  mode: "record" | "run";
  viewport: { width: number; height: number };
}

export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [passInfo, setPassInfo] = useState<PassInfo>({
    pass: "before",
    done: { before: false, after: false },
    resetStorage: true,
  });
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string | undefined>();
  const [steps, setSteps] = useState<StepSummary[]>([]);
  const [pause, setPause] = useState<{ label: string } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<{ before?: string; after?: string } | null>(null);
  const [resetPrompt, setResetPrompt] = useState<{ pass: "before" | "after"; defaultReset: boolean } | null>(null);

  const send = useMemo(
    () =>
      connect((msg: ServerMessage) => {
        switch (msg.type) {
          case "HELLO":
            setPhase(msg.phase);
            setSteps(msg.steps);
            setPassInfo(msg.passInfo);
            break;
          case "PASS_CHANGED":
            setPassInfo(msg.passInfo);
            break;
          case "PHASE_CHANGED":
            setPhase(msg.phase);
            setDetail(msg.detail);
            if (msg.phase === "recording") setError(null);
            if (msg.phase !== "encoding") setProgress(null);
            setPause(null);
            break;
          case "STEP_ADDED":
            setSteps((s) => [...s, msg.step]);
            break;
          case "STEP_UPDATED":
            setSteps((s) => s.map((x) => (x.id === msg.step.id ? msg.step : x)));
            break;
          case "STEP_REMOVED":
            setSteps((s) => s.filter((x) => x.id !== msg.stepId));
            break;
          case "STEPS_RESET":
            setSteps(msg.steps);
            break;
          case "ENCODE_PROGRESS":
            setProgress({ label: msg.stage, done: msg.done, total: msg.total });
            break;
          case "MANUAL_PAUSE":
            setPause({ label: msg.label });
            break;
          case "RESET_PROMPT":
            setResetPrompt({ pass: msg.pass, defaultReset: msg.defaultReset });
            break;
          case "GIF_READY":
            break;
          case "DONE":
            setOutputs(msg.outputs);
            break;
          case "ERROR":
            setError(msg.message);
            break;
        }
      }),
    [],
  );

  // Fetch the iframe target on load (and after Node switches apps + reloads us).
  useEffect(() => {
    fetch("/runtime.json")
      .then((r) => r.json())
      .then((cfg: Runtime) => setRuntime(cfg))
      .catch(() => {});
  }, []);

  // Enter is a tool accelerator: it drives the primary CTA (Continue a pause,
  // or Confirm the steps) — never the app. (When the iframe has focus, the
  // injected recorder forwards Enter during pauses; this covers harness focus.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (resetPrompt) return; // explicit click required for a consequential reset
      if (pause) {
        e.preventDefault();
        setPause(null);
        send({ type: "CONTINUE" });
      } else if (phase === "idle" && steps.length > 0) {
        e.preventDefault();
        send({ type: "CONFIRM" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pause, phase, steps.length, send, resetPrompt]);

  // Scale-to-fit: the app keeps its full logical resolution (e.g. 1920×1080)
  // and is visually scaled to fit the stage, preserving the ratio. Resizing
  // the window only changes the scale, never the app's dimensions.
  const stageRef = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !runtime) return;
    const PAD = 20;
    const update = () => {
      const s = Math.min(
        1,
        (stage.clientWidth - PAD) / runtime.viewport.width,
        (stage.clientHeight - PAD) / runtime.viewport.height,
      );
      setScale(Math.max(0.1, s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [runtime]);

  const hasTabs = Boolean(passInfo.branches);
  return (
    <div class={`layout ${hasTabs ? "layout--tabs" : ""}`}>
      <Banner phase={phase} />
      {hasTabs && <Tabs passInfo={passInfo} />}
      <main class="stage" ref={stageRef}>
        {runtime ? (
          <div
            class="stage-fit"
            style={{
              width: `${runtime.viewport.width * scale}px`,
              height: `${runtime.viewport.height * scale}px`,
            }}
          >
            <iframe
              id="app-frame"
              src={runtime.appUrl}
              title="Application under preview"
              // Delegate permission-policy features to the (cross-origin) app
              // so geolocation/camera/mic/etc. work inside the iframe.
              allow="geolocation; camera; microphone; clipboard-read; clipboard-write; midi; accelerometer; gyroscope; magnetometer; payment; fullscreen; autoplay; encrypted-media"
              style={{
                width: `${runtime.viewport.width}px`,
                height: `${runtime.viewport.height}px`,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        ) : (
          <div class="stage-empty">Waiting for the app …</div>
        )}
        {runtime && (phase === "idle" || phase === "recording") && (
          <button
            class="iframe-refresh"
            title="Reload the app inside the frame"
            onClick={() => send({ type: "RELOAD_IFRAME" })}
          >
            <Icon name="restart" />
          </button>
        )}
        {pause && (
          <PausePopup
            label={pause.label}
            onContinue={() => {
              setPause(null);
              send({ type: "CONTINUE" });
            }}
          />
        )}
        {resetPrompt && (
          <>
            <div class="stage-scrim" />
            <ResetPopup
              pass={resetPrompt.pass}
              defaultReset={resetPrompt.defaultReset}
              onChoose={(reset) => {
                setResetPrompt(null);
                send({ type: "RESET_CHOICE", reset });
              }}
            />
          </>
        )}
      </main>
      <aside class="sidebar">
        <Stepper passInfo={passInfo} phase={phase} />
        <ProgressBar phase={phase} progress={progress} />
        <Prompt phase={phase} passInfo={passInfo} hasSteps={steps.length > 0} send={send} />
        <StatusBar phase={phase} detail={detail} pause={pause} outputs={outputs} error={error} />
        <StepList steps={steps} phase={phase} send={send} />
        {!resetPrompt && (
          <ActionBar phase={phase} pass={passInfo.pass} hasSteps={steps.length > 0} pause={pause} send={send} />
        )}
        <Footer />
      </aside>
    </div>
  );
}
