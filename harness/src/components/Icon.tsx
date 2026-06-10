/**
 * Small monochrome inline-SVG icon set (replaces all emoji in the UI).
 * Icons are 1em square, inherit `currentColor`, and align to text.
 */
export type IconName =
  | "record"
  | "stop"
  | "check"
  | "play"
  | "arrowRight"
  | "retry"
  | "restart"
  | "loadBefore"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "navigate"
  | "lock"
  | "clock"
  | "external";

const P: Record<IconName, preact.JSX.Element> = {
  record: <circle cx="8" cy="8" r="5" fill="currentColor" stroke="none" />,
  stop: <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />,
  check: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  play: <path d="M5 3.5 12 8 5 12.5Z" fill="currentColor" stroke="none" />,
  arrowRight: <path d="M3 8h9m-3.5-3.5L12 8l-3.5 3.5" />,
  retry: <path d="M12.5 6A5 5 0 1 0 13 9.5M12.5 3v3h-3" />,
  restart: <path d="M3.5 6A5 5 0 1 1 3 9.5M3.5 3v3h3" />,
  loadBefore: <path d="M13 8H4m3.5-3.5L4 8l3.5 3.5" />,
  click: <path d="M5 3v8l2-2 1.5 3 1.5-.7L8.5 8H11Z" fill="currentColor" stroke="none" />,
  type: (
    <g>
      <rect x="2" y="4.5" width="12" height="7" rx="1.2" />
      <path d="M4.5 7h0M7 7h0M9.5 7h0M5.5 9h5" stroke-linecap="round" />
    </g>
  ),
  key: <path d="M11.5 4.5 4 12m0-3v3h3m4.5-7.5L13 6" stroke-linecap="round" />,
  scroll: <path d="M8 3v10m-2.5-7.5L8 3l2.5 2.5m-5 5L8 13l2.5-2.5" />,
  navigate: <path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-2 2a2.5 2.5 0 0 1-3.5-3.5l1-1" />,
  lock: (
    <g>
      <rect x="3.5" y="7" width="9" height="6" rx="1.3" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
    </g>
  ),
  clock: (
    <g>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" stroke-linecap="round" />
    </g>
  ),
  external: <path d="M6 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12v-2M9 3.5h4v4M13 3.5 7 9.5" />,
};

export function Icon({ name, class: cls }: { name: IconName; class?: string }) {
  return (
    <svg
      class={`icon ${cls ?? ""}`}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
