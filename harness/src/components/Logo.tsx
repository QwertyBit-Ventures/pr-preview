interface Props {
  /** Icon size in px. */
  size?: number;
  /** Show the "PR Preview" wordmark beside the mark. */
  wordmark?: boolean;
  /** Show the "Free & Open Source" pill. */
  tagline?: boolean;
}

/** The pr-preview mark: a clapperboard (clip editing) fused with a +/− code diff. */
function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="prp-mark" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop stop-color="#635BFF" />
          <stop offset="1" stop-color="#4B45C6" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#prp-mark)" />
      <g transform="rotate(-9 32 19)">
        <rect x="13" y="13.5" width="38" height="9.5" rx="2.4" fill="#fff" />
        <path
          d="M19 13.5 24 23M27 13.5 32 23M35 13.5 40 23M43 13.5 48 23"
          stroke="#4B45C6"
          stroke-width="2.3"
          stroke-linecap="round"
        />
      </g>
      <rect x="13" y="26" width="38" height="24" rx="4.5" fill="#fff" />
      <g stroke="#4B45C6" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M23 32 17.5 38 23 44" />
        <path d="M41 32 46.5 38 41 44" />
        <path d="M35.5 30.5 28.5 45.5" stroke="#635BFF" />
      </g>
    </svg>
  );
}

export function Logo({ size = 28, wordmark = true, tagline = true }: Props) {
  return (
    <span class="logo">
      <Mark size={size} />
      {wordmark && <span class="logo-word">PR Preview</span>}
      {tagline && <span class="logo-tag">Free &amp; Open Source</span>}
    </span>
  );
}
