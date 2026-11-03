// @ts-check
// A QR code for a private APK link, made to scan from paper or a screen:
// pure black on white, high error correction (H, about 30% of the code
// can be damaged), a wide quiet border, 1200 px.
//   node scripts/render-qr.mjs <https url>=<out.png> ...
// The repository is public and the APK is private, so this refuses to
// write inside the repository: keep the file next to the APK on D:.
// Check the result by decoding it (docs/HANDOFF.md, "QR codes").
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/render-qr.mjs <https url>=<out.png> ...  (out.png outside the repository)");
  process.exit(2);
}
const jobs = args.map((arg) => {
  const i = arg.lastIndexOf("=");
  if (i < 1 || !/^https:\/\//.test(arg)) throw new Error("expected <https url>=<out.png>");
  const out = path.resolve(arg.slice(i + 1));
  const rel = path.relative(repo, out);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`refusing to write a QR code inside the repository: ${out}`);
  }
  return { url: arg.slice(0, i), out };
});

for (const { url, out } of jobs) {
  await QRCode.toFile(out, url, {
    type: "png",
    errorCorrectionLevel: "H",
    margin: 6, // modules of white border (the standard asks for at least 4)
    width: 1200,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  console.log(`QR code written to ${out}`);
}
