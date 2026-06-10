import { spawn } from "node:child_process";

/**
 * Reveal a path in the OS file manager (Finder / Explorer / default handler).
 * Best-effort and non-blocking — never throws, and stays out of the way in
 * headless/CI environments where there's no desktop to open.
 */
export function openPath(target: string): void {
  if (process.env.PR_PREVIEW_HEADLESS === "1" || process.env.CI) return;

  const [cmd, args] =
    process.platform === "darwin"
      ? (["open", [target]] as const)
      : process.platform === "win32"
        ? (["cmd", ["/c", "start", "", target]] as const)
        : (["xdg-open", [target]] as const);

  try {
    const child = spawn(cmd, [...args], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* opening the folder is a nicety, never a failure */
  }
}

/**
 * Reveal the produced files in the file manager. On macOS this opens the
 * folder with the files selected; elsewhere it just opens the folder.
 */
export function revealFiles(files: string[], dir: string): void {
  if (process.env.PR_PREVIEW_HEADLESS === "1" || process.env.CI) return;
  if (process.platform === "darwin" && files.length > 0) {
    try {
      const child = spawn("open", ["-R", ...files], { detached: true, stdio: "ignore" });
      child.on("error", () => openPath(dir));
      child.unref();
      return;
    } catch {
      /* fall through to opening the folder */
    }
  }
  openPath(dir);
}
