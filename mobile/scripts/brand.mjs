// @ts-check
// The NR Management monogram: an original "NR" drawn as plain strokes (no
// font, no third-party artwork) in the website's palette. Every app icon,
// the splash image and the GitHub social preview are rendered from here by
// scripts/render-assets.mjs.

export const PALETTE = {
  ground: "#0a0a0a",
  panel: "#111111",
  ink: "#ededed",
  muted: "#a1a1a1",
  accent: "#3b82f6",
};

/**
 * The glyph on a 1024 grid, centred on (512, 512): N, then R whose leg is
 * the accent colour. Bounding box incl. stroke ≈ 624 × 424.
 * @param {{ ink?: string, accent?: string, scale?: number }} [o]
 */
export function glyph({ ink = PALETTE.ink, accent = PALETTE.accent, scale = 1 } = {}) {
  const t = `translate(512 512) scale(${scale}) translate(-512 -512)`;
  return `<g transform="${t}" fill="none" stroke-width="64" stroke-linecap="round" stroke-linejoin="round">
    <path d="M232 692V332L452 692V332" stroke="${ink}"/>
    <path d="M572 692V332H682a108 108 0 0 1 0 216H572" stroke="${ink}"/>
    <path d="M672 548L792 692" stroke="${accent}"/>
  </g>`;
}

/** Full app icon: rounded ground with a faint rim, glyph inside. */
export function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${PALETTE.ground}"/>
  <rect x="40" y="40" width="944" height="944" rx="200" fill="none" stroke="${PALETTE.ink}" stroke-opacity="0.14" stroke-width="8"/>
  ${glyph({ scale: 0.92 })}
</svg>`;
}

/**
 * Android adaptive icon foreground: transparent, glyph inside the 66/108
 * safe circle (diameter ≈ 626 px of 1024) so no launcher mask clips it.
 * @param {{ mono?: boolean }} [o]
 */
export function adaptiveForegroundSvg({ mono = false } = {}) {
  const ink = mono ? "#ffffff" : PALETTE.ink;
  const accent = mono ? "#ffffff" : PALETTE.accent;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${glyph({ ink, accent, scale: 0.78 })}
</svg>`;
}

/** Status-bar notification icon: white on transparent (Android tints it). */
export function notificationSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${glyph({ ink: "#ffffff", accent: "#ffffff", scale: 1.5 })}
</svg>`;
}

/** Splash image (shown on the ground colour from app config). */
export function splashSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${glyph({ scale: 1.2 })}
</svg>`;
}

/** 1280×640 GitHub social preview. Text uses the font given to resvg. */
export function socialPreviewSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <rect width="1280" height="640" fill="${PALETTE.ground}"/>
  <rect x="24" y="24" width="1232" height="592" rx="28" fill="none" stroke="${PALETTE.ink}" stroke-opacity="0.08" stroke-width="2"/>
  <g transform="translate(96 152) scale(0.328)">
    <rect width="1024" height="1024" rx="220" fill="${PALETTE.panel}" stroke="${PALETTE.ink}" stroke-opacity="0.16" stroke-width="8"/>
    ${glyph({ scale: 0.92 })}
  </g>
  <g font-family="Geist, DejaVu Sans, sans-serif">
    <text x="480" y="286" font-size="72" font-weight="600" fill="${PALETTE.ink}">NR Management</text>
    <text x="482" y="348" font-size="30" fill="${PALETTE.muted}">Order management for NR Industries</text>
    <text x="482" y="392" font-size="30" fill="${PALETTE.muted}">Website + Android app · real-time · Supabase</text>
    <rect x="482" y="430" width="96" height="6" rx="3" fill="${PALETTE.accent}"/>
  </g>
</svg>`;
}
