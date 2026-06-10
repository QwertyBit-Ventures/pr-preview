/**
 * Entry for the in-page bundle (built as an IIFE by tsup, injected by Node
 * via addInitScript into every frame).
 *
 * Self-gates: only activates inside an iframe (the target app), never in the
 * harness top frame.
 */

import { installRecorder } from "./recorder.js";
import { installCursor } from "./cursor.js";

(() => {
  try {
    if (window.self === window.top) return; // harness top frame — stay out
  } catch {
    // cross-origin access to window.top throws → we ARE in an iframe
  }
  installRecorder();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installCursor);
  } else {
    installCursor();
  }
})();
