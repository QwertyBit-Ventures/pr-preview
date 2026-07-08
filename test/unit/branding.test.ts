import { describe, it, expect } from "vitest";
import {
  TEAMS_URL,
  osc8,
  teamsPromoMarkdown,
  teamsPromoTerminal,
} from "../../src/branding.js";

describe("branding", () => {
  it("osc8 wraps the label with the OSC 8 hyperlink escape", () => {
    const seq = osc8("https://example.com", "click me");
    expect(seq).toBe("\x1b]8;;https://example.com\x1b\\click me\x1b]8;;\x1b\\");
    expect(seq.startsWith("\x1b]8;;")).toBe(true);
    expect(seq.endsWith("\x1b]8;;\x1b\\")).toBe(true);
  });

  it("teamsPromoMarkdown links to the early-access list", () => {
    const md = teamsPromoMarkdown();
    expect(md).toContain(TEAMS_URL);
    expect(md).toContain(`](${TEAMS_URL})`);
    expect(md).toContain("PR Preview for Teams");
  });

  it("teamsPromoTerminal always contains the early-access URL", () => {
    // Whether or not the URL is wrapped in an OSC 8 escape (TTY-dependent),
    // the raw URL is present so it stays visible/clickable everywhere.
    expect(teamsPromoTerminal()).toContain(TEAMS_URL);
  });
});
