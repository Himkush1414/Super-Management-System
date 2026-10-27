// @ts-check
// Remembers the website's last background colour on the phone, so the next
// start paints the root view, bars and WebView in that colour from the
// first frame (no white flash, no wrong-coloured bars). Only this colour is
// stored: never page content or data.
import { File, Paths } from "expo-file-system";
import { cssColorToHex } from "./colors";

const NAME = "shell-colors.json";

/** @returns {string | null} the cached #rrggbb, read synchronously at start */
export function loadCachedBg() {
  try {
    const f = new File(Paths.document, NAME);
    if (!f.exists) return null;
    const v = JSON.parse(f.textSync());
    return cssColorToHex(v?.bg);
  } catch {
    return null;
  }
}

/** @param {string} bg #rrggbb */
export function saveCachedBg(bg) {
  try {
    const f = new File(Paths.document, NAME);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify({ bg }));
  } catch {
    // a colour that isn't cached only costs one start in the default colour
  }
}
