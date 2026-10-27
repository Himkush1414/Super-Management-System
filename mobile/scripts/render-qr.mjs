// @ts-check
// QR codes for the APK download links, made to scan from paper or a
// screen: pure black on white, high error correction (H, about 30% of
// the code can be damaged), a wide quiet border, 1200 px.
//   node scripts/render-qr.mjs                      -> docs/assets/qr-download.png (APK_URL)
//   node scripts/render-qr.mjs <url>=<out.png> ...  -> each url into its file
// Check the result by decoding it (docs/HANDOFF.md, "QR codes").
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

/** The permanent link: always the newest release's APK. */
export const APK_URL =
  "https://github.com/Himkush1414/Super-Management-System/releases/latest/download/NR-Management.apk";

const here = path.dirname(fileURLToPath(import.meta.url));
const jobs = process.argv.length > 2
  ? process.argv.slice(2).map((arg) => {
    const i = arg.lastIndexOf("=");
    if (i < 1 || !/^https:\/\//.test(arg)) throw new Error(`expected <https url>=<out.png>, got ${arg}`);
    return { url: arg.slice(0, i), out: path.resolve(arg.slice(i + 1)) };
  })
  : [{ url: APK_URL, out: path.resolve(here, "../../docs/assets/qr-download.png") }];

for (const { url, out } of jobs) {
  await QRCode.toFile(out, url, {
    type: "png",
    errorCorrectionLevel: "H",
    margin: 6, // modules of white border (the standard asks for at least 4)
    width: 1200,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  console.log(`${path.relative(process.cwd(), out)} -> ${url}`);
}
