/**
 * Signal-safe teardown: register cleanups (dev servers, worktrees, browser)
 * and run them on normal exit, Ctrl-C, or crash — never leak a worktree.
 */

type Cleanup = () => Promise<void> | void;

const cleanups: Cleanup[] = [];
let installed = false;
let running = false;

export function registerCleanup(fn: Cleanup): () => void {
  install();
  cleanups.push(fn);
  return () => {
    const i = cleanups.indexOf(fn);
    if (i >= 0) cleanups.splice(i, 1);
  };
}

export async function runCleanups(): Promise<void> {
  if (running) return;
  running = true;
  // LIFO: tear down in reverse acquisition order.
  for (const fn of [...cleanups].reverse()) {
    try {
      await fn();
    } catch {
      /* best effort */
    }
  }
  cleanups.length = 0;
  running = false;
}

function install(): void {
  if (installed) return;
  installed = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void runCleanups().then(() => process.exit(130));
    });
  }
  process.on("uncaughtException", (err) => {
    console.error(err);
    void runCleanups().then(() => process.exit(1));
  });
}
