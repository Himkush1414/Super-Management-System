// @ts-check
// The README icon and the GitHub social preview, built around the owner's
// logo (assets/icon.png, itself rendered by scripts/render-logo.py). Rendered
// by scripts/render-assets.mjs.

export const PALETTE = {
  ground: "#0a0a0a",
  ink: "#ededed",
  muted: "#a1a1a1",
  gold: "#f8be03",
};

/** @param {string} logo the logo as a data: address */
function tile(logo) {
  return `<clipPath id="tile"><rect width="1024" height="1024" rx="220"/></clipPath>
    <image href="${logo}" width="1024" height="1024" clip-path="url(#tile)"/>`;
}

/**
 * The logo on its white ground, with rounded corners.
 * @param {string} logo
 */
export function iconSvg(logo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${tile(logo)}
</svg>`;
}

/**
 * 1280×640 GitHub social preview. Text uses the font given to resvg.
 * @param {string} logo
 */
export function socialPreviewSvg(logo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="640" viewBox="0 0 1280 640">
  <rect width="1280" height="640" fill="${PALETTE.ground}"/>
  <rect x="24" y="24" width="1232" height="592" rx="28" fill="none" stroke="${PALETTE.ink}" stroke-opacity="0.08" stroke-width="2"/>
  <svg x="96" y="152" width="335.872" height="335.872" viewBox="0 0 1024 1024">
    ${tile(logo)}
  </svg>
  <g font-family="Geist, DejaVu Sans, sans-serif">
    <text x="480" y="286" font-size="72" font-weight="600" fill="${PALETTE.ink}">NR Management</text>
    <text x="482" y="348" font-size="30" fill="${PALETTE.muted}">Order management for NR Industries</text>
    <text x="482" y="392" font-size="30" fill="${PALETTE.muted}">Website + Android app · real-time · Supabase</text>
    <rect x="482" y="430" width="96" height="6" rx="3" fill="${PALETTE.gold}"/>
  </g>
</svg>`;
}
