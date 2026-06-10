/**
 * Core data shapes: raw in-page events, normalized steps, and the journey file.
 * No Node imports — these types are shared with the in-page recorder bundle.
 */

/** Raw event emitted by the in-page recorder via the exposed binding. */
export type RawEvent =
  | {
      kind: "click";
      selectors: string[];
      xNorm: number;
      yNorm: number;
      text?: string;
      frameUrl: string;
      ts: number;
    }
  | {
      kind: "input";
      selectors: string[];
      value: string;
      xNorm: number;
      yNorm: number;
      frameUrl: string;
      ts: number;
    }
  | {
      kind: "key";
      key: string;
      selectors: string[];
      frameUrl: string;
      ts: number;
    }
  | {
      kind: "scroll";
      target: string; // "window" or a selector
      xNorm: number; // scrollLeft / scrollWidth
      yNorm: number; // scrollTop / scrollHeight
      frameUrl: string;
      ts: number;
    }
  | {
      kind: "select";
      selectors: string[];
      value: string;
      xNorm: number;
      yNorm: number;
      frameUrl: string;
      ts: number;
    }
  | {
      kind: "navigate";
      url: string;
      frameUrl: string;
      ts: number;
    };

export type StepType = "click" | "fill" | "select" | "press" | "scroll" | "navigate" | "wait";

export interface Step {
  id: string;
  type: StepType;
  /** Ordered best→worst; every entry resolved uniquely at record time. */
  selectors?: string[];
  /** Viewport-normalized coordinates — the absolute fallback. */
  coordinates?: { xNorm: number; yNorm: number };
  /** Path (origin-relative) of the app at the time of the step. */
  frameUrl?: string;
  /** fill */
  value?: string;
  /** press */
  key?: string;
  /** scroll */
  scrollTarget?: string;
  scroll?: { xNorm: number; yNorm: number };
  /** navigate */
  url?: string;
  causesNavigation?: boolean;
  /** Human label for the sidebar row. */
  label?: string;
  /** ms offset from recording start. */
  timestamp: number;
  /** Small data-URL png for the sidebar; stripped when persisted. */
  thumbnail?: string;
}

export interface Journey {
  version: 1;
  createdAt: string;
  baseRef?: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  startUrl: string;
  steps: Step[];
}

/** Human-readable one-liner for a step (sidebar rows, logs). */
export function describeStep(step: Step): string {
  switch (step.type) {
    case "click":
      return `Click ${step.label ?? firstSelector(step)}`;
    case "fill":
      return `Type "${truncate(step.value ?? "", 24)}" into ${firstSelector(step)}`;
    case "select":
      return `Select "${truncate(step.value ?? "", 24)}" in ${firstSelector(step)}`;
    case "press":
      return `Press ${step.key}`;
    case "scroll":
      return `Scroll ${step.scrollTarget === "window" ? "page" : step.scrollTarget ?? "page"}`;
    case "navigate":
      return `Go to ${step.url}`;
    case "wait":
      return "Wait";
  }
}

function firstSelector(step: Step): string {
  return step.selectors?.[0] ?? "element";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
