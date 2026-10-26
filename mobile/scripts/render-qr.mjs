// @ts-check
// QR code for the permanent APK download link (docs/assets/qr-download.png):
//   node scripts/render-qr.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

export const APK_URL =
  "https://github.com/Himkush1414/Super-Management-System/releases/latest/download/NR-Management.apk";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../docs/assets/qr-download.png");

await QRCode.toFile(out, APK_URL, {
  type: "png",
  errorCorrectionLevel: "M",
  margin: 2,
  width: 512,
  color: { dark: "#0a0a0aff", light: "#ffffffff" },
});
console.log(`${path.relative(process.cwd(), out)} -> ${APK_URL}`);
