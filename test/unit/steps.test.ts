import { describe, it, expect } from "vitest";
import { StepBuilder } from "../../src/recorder/steps.js";
import type { RawEvent } from "../../src/recorder/types.js";

const input = (value: string, opts: Partial<Extract<RawEvent, { kind: "input" }>> = {}): RawEvent => ({
  kind: "input",
  selectors: ['[data-testid="email"]'],
  value,
  xNorm: 0.5,
  yNorm: 0.4,
  frameUrl: "/login",
  ts: 100,
  ...opts,
});

const click = (selectors: string[], ts = 500): RawEvent => ({
  kind: "click",
  selectors,
  xNorm: 0.5,
  yNorm: 0.6,
  text: "Log in",
  frameUrl: "/login",
  ts,
});

describe("StepBuilder", () => {
  it("coalesces consecutive input events on the same field into one fill", () => {
    const b = new StepBuilder();
    b.handle(input("d"));
    b.handle(input("de"));
    b.handle(input("demo@example.com"));
    const steps = b.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "fill", value: "demo@example.com" });
  });

  it("starts a new fill when the field changes", () => {
    const b = new StepBuilder();
    b.handle(input("demo"));
    b.handle(input("secret", { selectors: ['[data-testid="password"]'] }));
    const steps = b.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ type: "fill", value: "secret" });
  });

  it("annotates a click followed by quick navigation instead of adding a navigate step", () => {
    const b = new StepBuilder();
    b.handle(click(['[data-testid="login-btn"]'], 1000));
    b.handle({ kind: "navigate", url: "/app", frameUrl: "/app", ts: 1200 });
    const steps = b.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "click", causesNavigation: true });
  });

  it("keeps a standalone navigate as its own step", () => {
    const b = new StepBuilder();
    b.handle({ kind: "navigate", url: "/app", frameUrl: "/app", ts: 5000 });
    expect(b.getSteps()[0]).toMatchObject({ type: "navigate", url: "/app" });
  });

  it("collapses consecutive scrolls on the same target", () => {
    const b = new StepBuilder();
    const scroll = (yNorm: number, ts: number): RawEvent => ({
      kind: "scroll",
      target: "window",
      xNorm: 0,
      yNorm,
      frameUrl: "/app",
      ts,
    });
    b.handle(scroll(0.2, 100));
    b.handle(scroll(0.7, 600));
    const steps = b.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.scroll!.yNorm).toBe(0.7);
  });

  it("truncateFrom drops the step and everything after", () => {
    const b = new StepBuilder();
    b.handle(click(["#a"], 1));
    b.handle(click(["#b"], 2));
    b.handle(click(["#c"], 3));
    const ids = b.getSteps().map((s) => s.id);
    b.truncateFrom(ids[1]!);
    expect(b.getSteps().map((s) => s.selectors![0])).toEqual(["#a"]);
  });

  it("absorbs the focus-click that precedes typing into the same field", () => {
    const b = new StepBuilder();
    b.handle(click(['[data-testid="email"]'], 100));
    b.handle(input("demo@example.com", { ts: 600 }));
    const steps = b.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "fill", value: "demo@example.com" });
  });

  it("keeps a click on a DIFFERENT element before a fill", () => {
    const b = new StepBuilder();
    b.handle(click(['[data-testid="login-btn"]'], 100));
    b.handle(input("demo", { ts: 600 }));
    expect(b.getSteps().map((s) => s.type)).toEqual(["click", "fill"]);
  });

  it("flushes a pending fill before an Enter press (order preserved)", () => {
    const b = new StepBuilder();
    b.handle(input("hello"));
    b.handle({ kind: "key", key: "Enter", selectors: ['[data-testid="email"]'], frameUrl: "/", ts: 200 });
    const steps = b.getSteps();
    expect(steps.map((s) => s.type)).toEqual(["fill", "press"]);
  });
});
