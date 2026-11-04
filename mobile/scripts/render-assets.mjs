// @ts-check
// Renders the documentation images from scripts/brand.mjs:
//   node scripts/render-assets.mjs
// Writes the GitHub social preview at docs/assets/social-preview.png and
// docs/assets/app-icon.png, both from the logo at assets/icon.png. The app's
// own icons, splash and notification icon: see scripts/render-logo.py.
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

const logo = `data:image/png;base64,${fs.readFileSync(path.join(mobile, "assets", "icon.png")).toString("base64")}`;

render(socialPreviewSvg(logo), 1280, path.join(repo, "docs/assets/social-preview.png"));
render(iconSvg(logo), 256, path.join(repo, "docs/assets/app-icon.png"));
