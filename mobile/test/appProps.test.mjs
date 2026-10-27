// @ts-check
// Guards for WebView props that Android hands to native code unchanged:
// a wrong JS type there crashes the app at start (unit tests of the page
// script can't see it; it showed up on the emulator).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../App.js", import.meta.url), "utf8");

test("dataDetectorTypes is an array (a plain string crashes Android)", () => {
  const props = [...app.matchAll(/dataDetectorTypes=(\S+)/g)].map((m) => m[1]);
  assert.ok(props.length > 0);
  for (const p of props) assert.match(p, /^\{\[/, `dataDetectorTypes=${p}`);
});

test("no onLoadStart timing on the WebViews (Android sends it for every address change)", () => {
  // react-native-webview (Android) fires onLoadStart from doUpdateVisitedHistory:
  // each tab switch inside the website, with no onLoadEnd after it. Timing
  // loads with it left the bar running and a 20 s "too slow" timer armed
  // after every tab switch. Loads are timed by startLoad() and the watchdog.
  assert.doesNotMatch(app, /onLoadStart=/);
});

test("the page cache follows the website's headers (pages never stored, scripts and styles cached)", () => {
  assert.match(app, /cacheMode="LOAD_DEFAULT"/);
});
