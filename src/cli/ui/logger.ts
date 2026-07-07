import pc from "picocolors";
import ora, { type Ora } from "ora";
import { createInterface } from "node:readline/promises";

export const log = {
  info(msg: string): void {
    console.log(`${pc.cyan("●")} ${msg}`);
  },
  success(msg: string): void {
    console.log(`${pc.green("✔")} ${msg}`);
  },
  warn(msg: string): void {
    console.log(`${pc.yellow("▲")} ${msg}`);
  },
  error(msg: string): void {
    console.error(`${pc.red("✖")} ${msg}`);
  },
  step(msg: string): void {
    console.log(pc.dim(`  ${msg}`));
  },
  spinner(text: string): Ora {
    return ora({ text, color: "cyan" }).start();
  },
  /**
   * Ask a yes/no question. Defaults to "no". In a non-interactive shell
   * (no TTY, e.g. CI) it resolves to `false` without blocking.
   */
  async confirm(question: string): Promise<boolean> {
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`${pc.yellow("?")} ${question} ${pc.dim("(y/N)")} `);
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  },
};
