import pc from "picocolors";
import ora, { type Ora } from "ora";

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
};
