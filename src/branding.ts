import pc from "picocolors";

/** Marketing site root. */
export const SITE_URL = "https://pr-preview.com";
/** Early-access signup for PR Preview for Teams. */
export const TEAMS_URL = "https://pr-preview.com/#teams";

/**
 * Wrap `label` in an OSC 8 terminal hyperlink pointing at `url`. Terminals that
 * support OSC 8 (iTerm2, WezTerm, kitty, VS Code, GNOME Terminal, …) render it
 * as a clickable link; those that don't simply ignore the escape and show the
 * label as plain text, so it's safe to emit unconditionally on a TTY.
 */
export function osc8(url: string, label: string): string {
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

/** True when stdout can render escape sequences (interactive terminal). */
function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";
}

/**
 * The end-of-recording promo, styled for a real terminal. On an interactive TTY
 * the URL is a clickable OSC 8 hyperlink; otherwise (pipe, CI, dumb terminal)
 * it degrades to the plain URL.
 */
export function teamsPromoTerminal(): string {
  const link = isInteractive() ? osc8(TEAMS_URL, TEAMS_URL) : TEAMS_URL;
  return [
    `${pc.magenta("★")} ${pc.bold("Love it? PR Preview for Teams is coming")} —`,
    pc.dim("  hosted clips, team reviews & sharing."),
    `  Join the early-access list → ${pc.cyan(link)}`,
  ].join("\n");
}

/**
 * Markdown variant of the promo for surfaces that render markdown (the MCP
 * `finish_recording` return, which Claude relays to the user in chat).
 */
export function teamsPromoMarkdown(): string {
  return (
    "💜 Enjoying this? **PR Preview for Teams** — hosted clips, team reviews & sharing — " +
    `is coming soon. [Join the early-access list →](${TEAMS_URL})`
  );
}

/** Print the terminal promo as the final block of a manual CLI run. */
export function printTeamsPromo(): void {
  console.log();
  console.log(teamsPromoTerminal());
}
