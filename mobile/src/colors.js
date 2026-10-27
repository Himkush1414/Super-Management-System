// @ts-check
// The website's background colour, as the page reports it, turned into the
// colours of the app around it (root view, status bar, navigation bar,
// offline screen). Pure functions so they run under `node --test`.

/** Matches the website's dark theme (its default) until the page reports. */
const DEFAULT_BG = "#0a0a0a";

const PALETTES = {
  dark: { panel: "#111111", text: "#ededed", muted: "#a1a1a1", accent: "#3b82f6" },
  light: { panel: "#ffffff", text: "#171717", muted: "#4b4b4b", accent: "#1d4ed8" },
};

/**
 * A CSS colour from getComputedStyle (rgb()/rgba()/#hex) as #rrggbb, or
 * null when it can't be used (unparsable or see-through).
 * @param {unknown} css
 * @returns {string | null}
 */
function cssColorToHex(css) {
  if (typeof css !== "string") return null;
  const s = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1];
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  if (m[4] !== undefined) {
    const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(a >= 0.99)) return null; // transparent body: the page shows something else behind it
  }
  const parts = [m[1], m[2], m[3]].map((v) => Number(v));
  if (parts.some((v) => v > 255)) return null;
  return `#${parts.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Perceived lightness (WCAG relative luminance) above the middle.
 * @param {string} hex #rrggbb
 */
function isLight(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

/**
 * Colours for the app around the page.
 * @param {string} bg #rrggbb
 * @returns {{ bg: string, panel: string, text: string, muted: string, accent: string, light: boolean, bars: "light" | "dark" }}
 */
function shellColors(bg) {
  const light = isLight(bg);
  // bars: "dark" = dark icons on a light page, "light" = light icons on a dark page
  return { bg, ...PALETTES[light ? "light" : "dark"], light, bars: light ? "dark" : "light" };
}

module.exports = { DEFAULT_BG, cssColorToHex, isLight, shellColors };
