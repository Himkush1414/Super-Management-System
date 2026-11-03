// @ts-check
// Renders the documentation images from scripts/brand.mjs:
//   node scripts/render-assets.mjs
// Writes mobile/assets/brand/*.svg, the GitHub social preview at
// docs/assets/social-preview.png and docs/assets/app-icon.png.
// The app's own icons, splash and notification icon come from the owner's
// logo instead: see scripts/render-logo.py.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { iconSvg, socialPreviewSvg } from "./brand.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, "..");
const repo = path.resolve(mobile, "..");

// Geist (OFL) ships with the website's Next.js install; DejaVu is the fallback.
const fontFiles = [
  path.join(repo, "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
].filter((f) => fs.existsSync(f));

/** @param {string} svg @param {number} width @param {string} out */
function render(svg, width, out) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Geist" },
  })
    .render()
    .asPng();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`${path.relative(repo, out)}  ${width}px  ${png.length} B`);
}

const brand = path.join(mobile, "assets", "brand");
fs.mkdirSync(brand, { recursive: true });

const sources = {
  "icon.svg": iconSvg(),
  "social-preview.svg": socialPreviewSvg(),
};
for (const [name, svg] of Object.entries(sources)) fs.writeFileSync(path.join(brand, name), svg + "\n");

render(sources["social-preview.svg"], 1280, path.join(repo, "docs/assets/social-preview.png"));
render(sources["icon.svg"], 256, path.join(repo, "docs/assets/app-icon.png"));
