// @ts-check
// Keeps the Diagnostics screen's list of recent navigations on the phone,
// so it is still there after the app was closed. Only timings and page
// paths are stored: never page content, data, query strings or the session.
import { File, Paths } from "expo-file-system";
import { parseLog } from "./loading";

const NAME = "diagnostics.json";

/** @returns {import('./loading').LogEntry[]} */
export function loadLog() {
  try {
    const f = new File(Paths.document, NAME);
    if (!f.exists) return [];
    return parseLog(JSON.parse(f.textSync()));
  } catch {
    return [];
  }
}

/** @param {import('./loading').LogEntry[]} log */
export function saveLog(log) {
  try {
    const f = new File(Paths.document, NAME);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(log));
  } catch {
    // diagnostics only: a log that isn't saved costs nothing else
  }
}
