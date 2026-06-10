/** Adversity is controlled by URL query flags so tests can dial each knob. */
export interface Chaos {
  lat: number; // base latency for async work (ms)
  spinner: boolean; // cover the UI with a spinner during async work
  otp: boolean; // require a 2FA code after login
  modal: boolean; // show a welcome modal that must be dismissed
  feed: boolean; // stream feed items over time
  popup: boolean; // offer an OAuth-style popup sign-in
  flaky: boolean; // briefly unmount a control mid-interaction (transient race)
}

export function readChaos(): Chaos {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  const bool = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== "0" : d);
  return {
    lat: num("lat", 1500),
    spinner: bool("spinner", true),
    otp: bool("otp", false),
    modal: bool("modal", false),
    feed: bool("feed", false),
    popup: bool("popup", false),
    flaky: bool("flaky", false),
  };
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
