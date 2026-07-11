import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The /record skill text lives in three places that MUST stay identical:
//   1. src/cli/commands/init.ts  — the RECORD_SKILL template `pr-preview init`
//      writes into each user's .claude/skills/record/SKILL.md
//   2. SKILL.md                  — root skill file the marketplace reads first
//   3. skills/record/SKILL.md    — skill in the required /skills/ directory
// If you edit the skill, edit all three (or refactor init.ts to read the file).
// This test fails the moment they diverge.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

/** Pull the RECORD_SKILL template literal out of init.ts and unescape it. */
function embeddedRecordSkill(): string {
  const src = read("src/cli/commands/init.ts");
  const marker = "const RECORD_SKILL = `";
  const start = src.indexOf(marker);
  expect(start, "RECORD_SKILL not found in init.ts").toBeGreaterThanOrEqual(0);
  const bodyStart = start + marker.length;
  // The template closes with a bare backtick+semicolon at the start of a line.
  // Escaped backticks inside the body are "\`", so "\n`;" is unambiguous.
  const end = src.indexOf("\n`;", bodyStart);
  expect(end, "unterminated RECORD_SKILL template in init.ts").toBeGreaterThan(bodyStart);
  return src.slice(bodyStart, end + 1).replace(/\\`/g, "`");
}

describe("record skill copies stay in sync", () => {
  const embedded = embeddedRecordSkill();

  it("skills/record/SKILL.md matches the init.ts template", () => {
    expect(read("skills/record/SKILL.md")).toBe(embedded);
  });

  it("root SKILL.md matches the init.ts template", () => {
    expect(read("SKILL.md")).toBe(embedded);
  });
});
