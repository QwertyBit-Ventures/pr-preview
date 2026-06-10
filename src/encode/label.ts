import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export interface LabelSpec {
  pass: "before" | "after" | "single";
  /** Branch this clip shows. */
  branch: string;
  /** The PR base / main branch. */
  baseBranch: string;
  /** Pre-formatted timestamp, e.g. "2026-06-08 10:21". */
  timestamp: string;
  /** Output clip width in px — the caption scales to it. */
  videoWidth: number;
}

const BLURPLE = "#635BFF";
const GREEN = "#2DA44E";
const INK = "#1F2328";
const MUTED = "#57606A";

/** Locate the bundled Inter font (dist/assets at runtime, repo assets in tests). */
function fontFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../assets/fonts/Inter.ttf"), // dist/encode → dist/../assets? n/a
    path.resolve(here, "../assets/fonts/Inter.ttf"), // dist/encode → dist/assets
    path.resolve(here, "../../../assets/fonts/Inter.ttf"), // src/encode → repo/assets
  ];
  return candidates.find(existsSync) ?? candidates[candidates.length - 1]!;
}

/**
 * Silence fontconfig's "Cannot load default config" stderr noise by pointing
 * it at a generated minimal config that also exposes the bundled font dir.
 * Runs once, lazily, before the first text render.
 */
let fontconfigReady = false;
function ensureFontconfig(): void {
  if (fontconfigReady || process.env.FONTCONFIG_FILE) {
    fontconfigReady = true;
    return;
  }
  try {
    const dir = path.join(tmpdir(), "pr-preview-fontconfig");
    mkdirSync(dir, { recursive: true });
    const conf = path.join(dir, "fonts.conf");
    writeFileSync(
      conf,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${path.dirname(fontFile())}</dir>
  <cachedir>${path.join(dir, "cache")}</cachedir>
</fontconfig>
`,
    );
    process.env.FONTCONFIG_FILE = conf;
  } catch {
    /* the explicit fontfile still works without this — just noisier */
  }
  fontconfigReady = true;
}

function escapeMarkup(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a polished caption pill (PNG with alpha) naming the branch, the base
 * it's compared against, and the timestamp — composited onto every output
 * frame so the clip is self-describing.
 */
export async function renderLabel(spec: LabelSpec): Promise<Buffer> {
  ensureFontconfig();

  const accent = spec.pass === "after" ? GREEN : BLURPLE;
  const branch = escapeMarkup(spec.branch);
  const base = escapeMarkup(spec.baseBranch);
  const ts = escapeMarkup(spec.timestamp);

  // One Pango-markup run: colored dot + (tag), bold branch, muted context.
  // Single clips drop the BEFORE/AFTER pill and the base comparison.
  const tagSpan =
    spec.pass === "single"
      ? `<span foreground="${accent}" weight="700">●</span>`
      : `<span foreground="${accent}" weight="700">●  ${spec.pass === "before" ? "BEFORE" : "AFTER"}</span>`;
  const context =
    spec.pass === "single"
      ? `${ts}`
      : spec.pass === "before"
        ? `base branch · ${ts}`
        : `vs base ${base} · ${ts}`;

  const markup =
    `${tagSpan}` +
    `   <span foreground="${INK}" weight="700">${branch}</span>` +
    `   <span foreground="${MUTED}">${context}</span>`;

  const pt = Math.round(Math.min(28, Math.max(15, spec.videoWidth * 0.0145)));
  const text = await sharp({
    text: { text: markup, fontfile: fontFile(), font: `sans ${pt}`, rgba: true, dpi: 72 },
  })
    .png()
    .toBuffer();
  const tm = await sharp(text).metadata();
  const tw = tm.width ?? 200;
  const th = tm.height ?? pt;

  const padX = Math.round(pt * 0.85);
  const padY = Math.round(pt * 0.6);
  const w = tw + padX * 2;
  const h = th + padY * 2;
  const r = Math.round(h / 2);

  // Rounded-rect background (shapes only — always renders, no font needed).
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${r}" ry="${r}"
             fill="#FFFFFF" fill-opacity="0.94" stroke="#D0D7DE" stroke-opacity="0.9"/>
     </svg>`,
  );

  return sharp(bg)
    .composite([{ input: text, top: padY, left: padX }])
    .png()
    .toBuffer();
}

/** The pr-preview mark (clapperboard + </>) as an SVG string, for rasterizing. */
const LOGO_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
    <stop stop-color="#635BFF"/><stop offset="1" stop-color="#4B45C6"/></linearGradient></defs>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#g)"/>
  <g transform="rotate(-9 32 19)"><rect x="13" y="13.5" width="38" height="9.5" rx="2.4" fill="#fff"/>
    <path d="M19 13.5 24 23M27 13.5 32 23M35 13.5 40 23M43 13.5 48 23" stroke="#4B45C6" stroke-width="2.3" stroke-linecap="round"/></g>
  <rect x="13" y="26" width="38" height="24" rx="4.5" fill="#fff"/>
  <g stroke="#4B45C6" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M23 32 17.5 38 23 44"/><path d="M41 32 46.5 38 41 44"/><path d="M35.5 30.5 28.5 45.5" stroke="#635BFF"/></g>
</svg>`;

/**
 * A small bottom-right watermark: the pr-preview mark + the project URL,
 * burned into every clip.
 */
export async function renderWatermark(videoWidth: number): Promise<Buffer> {
  ensureFontconfig();
  const pt = Math.round(Math.min(22, Math.max(12, videoWidth * 0.0115)));
  const logoPx = Math.round(pt * 1.7);

  const logo = await sharp(Buffer.from(LOGO_SVG)).resize(logoPx, logoPx).png().toBuffer();
  const text = await sharp({
    text: {
      text: `<span foreground="${INK}" weight="600">pr-preview</span><span foreground="${MUTED}">.com</span>`,
      fontfile: fontFile(),
      font: `sans ${pt}`,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
  const tm = await sharp(text).metadata();
  const tw = tm.width ?? 120;
  const th = tm.height ?? pt;

  const gap = Math.round(pt * 0.5);
  const padX = Math.round(pt * 0.75);
  const padY = Math.round(pt * 0.5);
  const h = Math.max(logoPx, th) + padY * 2;
  const w = padX * 2 + logoPx + gap + tw;
  const r = Math.round(h / 2);

  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
       <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${r}" ry="${r}"
             fill="#FFFFFF" fill-opacity="0.94" stroke="#D0D7DE" stroke-opacity="0.9"/>
     </svg>`,
  );

  return sharp(bg)
    .composite([
      { input: logo, top: Math.round((h - logoPx) / 2), left: padX },
      { input: text, top: Math.round((h - th) / 2), left: padX + logoPx + gap },
    ])
    .png()
    .toBuffer();
}
