import type { RawEvent, Step } from "./types.js";

/**
 * Normalizes the raw in-page event stream into discrete steps:
 *  - consecutive `input` events on the same element coalesce into one `fill`
 *  - a click followed by navigation within 500ms gets `causesNavigation`
 *  - SPA `navigate` events right after a click are folded into the click
 */
export class StepBuilder {
  private steps: Step[] = [];
  private counter = 0;
  private pendingFill: Step | null = null;
  private listeners = new Set<(change: StepChange) => void>();

  onChange(listener: (change: StepChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: StepChange): void {
    for (const l of this.listeners) l(change);
  }

  private nextId(): string {
    return `stp_${String(++this.counter).padStart(2, "0")}`;
  }

  getSteps(): Step[] {
    this.flushFill();
    return [...this.steps];
  }

  /** Replace all steps (journey reuse / re-record truncation). */
  setSteps(steps: Step[]): void {
    this.pendingFill = null;
    this.steps = [...steps];
    this.counter = steps.length;
    this.notify({ kind: "reset" });
  }

  removeStep(id: string): void {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.steps.splice(i, 1);
      this.notify({ kind: "removed", stepId: id });
    }
  }

  /** Drop the given step and everything after it (re-record from there). */
  truncateFrom(id: string): Step[] {
    this.flushFill();
    const i = this.steps.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.steps = this.steps.slice(0, i);
      this.notify({ kind: "reset" });
    }
    return [...this.steps];
  }

  setThumbnail(id: string, thumbnail: string): Step | undefined {
    const step = this.steps.find((s) => s.id === id);
    if (step) {
      step.thumbnail = thumbnail;
      this.notify({ kind: "updated", step });
    }
    return step;
  }

  handle(event: RawEvent): void {
    switch (event.kind) {
      case "input": {
        const sameField =
          this.pendingFill &&
          selectorsOverlap(this.pendingFill.selectors ?? [], event.selectors);
        if (sameField && this.pendingFill) {
          this.pendingFill.value = event.value;
          this.pendingFill.timestamp = event.ts;
          this.notify({ kind: "updated", step: this.pendingFill });
        } else {
          this.flushFill();
          // A click that merely focused this field is redundant — replaying
          // the fill clicks the field anyway. Absorb it.
          const prev = this.steps[this.steps.length - 1];
          if (
            prev?.type === "click" &&
            selectorsOverlap(prev.selectors ?? [], event.selectors) &&
            event.ts - prev.timestamp < 3_000
          ) {
            this.steps.pop();
            this.notify({ kind: "removed", stepId: prev.id });
          }
          this.pendingFill = {
            id: this.nextId(),
            type: "fill",
            selectors: event.selectors,
            value: event.value,
            coordinates: { xNorm: event.xNorm, yNorm: event.yNorm },
            frameUrl: event.frameUrl,
            timestamp: event.ts,
          };
          this.steps.push(this.pendingFill);
          this.notify({ kind: "added", step: this.pendingFill });
        }
        break;
      }

      case "click": {
        this.flushFill();
        const step: Step = {
          id: this.nextId(),
          type: "click",
          selectors: event.selectors,
          coordinates: { xNorm: event.xNorm, yNorm: event.yNorm },
          frameUrl: event.frameUrl,
          label: event.text,
          timestamp: event.ts,
        };
        this.steps.push(step);
        this.notify({ kind: "added", step });
        break;
      }

      case "select": {
        this.flushFill();
        const step: Step = {
          id: this.nextId(),
          type: "select",
          selectors: event.selectors,
          value: event.value,
          coordinates: { xNorm: event.xNorm, yNorm: event.yNorm },
          frameUrl: event.frameUrl,
          timestamp: event.ts,
        };
        this.steps.push(step);
        this.notify({ kind: "added", step });
        break;
      }

      case "key": {
        // Enter inside a pending fill: flush the fill first, then the press.
        this.flushFill();
        const step: Step = {
          id: this.nextId(),
          type: "press",
          key: event.key,
          selectors: event.selectors,
          frameUrl: event.frameUrl,
          timestamp: event.ts,
        };
        this.steps.push(step);
        this.notify({ kind: "added", step });
        break;
      }

      case "scroll": {
        this.flushFill();
        // Collapse consecutive scrolls on the same target into the last one.
        const prev = this.steps[this.steps.length - 1];
        if (prev?.type === "scroll" && prev.scrollTarget === event.target) {
          prev.scroll = { xNorm: event.xNorm, yNorm: event.yNorm };
          prev.timestamp = event.ts;
          this.notify({ kind: "updated", step: prev });
        } else {
          const step: Step = {
            id: this.nextId(),
            type: "scroll",
            scrollTarget: event.target,
            scroll: { xNorm: event.xNorm, yNorm: event.yNorm },
            frameUrl: event.frameUrl,
            timestamp: event.ts,
          };
          this.steps.push(step);
          this.notify({ kind: "added", step });
        }
        break;
      }

      case "navigate": {
        this.flushFill();
        const prev = this.steps[this.steps.length - 1];
        // A click that triggered this navigation replays itself — just annotate.
        if (
          prev &&
          (prev.type === "click" || prev.type === "press") &&
          event.ts - prev.timestamp < 800
        ) {
          prev.causesNavigation = true;
          this.notify({ kind: "updated", step: prev });
        } else if (prev?.type === "navigate") {
          prev.url = event.url;
          prev.timestamp = event.ts;
          this.notify({ kind: "updated", step: prev });
        } else {
          const step: Step = {
            id: this.nextId(),
            type: "navigate",
            url: event.url,
            frameUrl: event.frameUrl,
            timestamp: event.ts,
          };
          this.steps.push(step);
          this.notify({ kind: "added", step });
        }
        break;
      }
    }
  }

  private flushFill(): void {
    this.pendingFill = null;
  }
}

export type StepChange =
  | { kind: "added"; step: Step }
  | { kind: "updated"; step: Step }
  | { kind: "removed"; stepId: string }
  | { kind: "reset" };

/** Two selector chains refer to the same element if any selector matches. */
function selectorsOverlap(a: string[], b: string[]): boolean {
  return a.some((s) => b.includes(s));
}
