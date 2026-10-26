// @ts-check
// iOS downloads: the page fetched the file with the session (see
// src/injected.js) and sent it here as base64. Save it to the app cache
// and open the share sheet so the user can keep it (Files, AirDrop, print).
// Android never comes here: its WebView hands attachments to the system
// DownloadManager together with the session cookie.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** @param {string} name */
function safeName(name) {
  const clean = String(name || "download").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
  return clean || "download";
}

/** @param {{ name: string, mime: string, data: string }} f */
export async function saveAndShareFile(f) {
  if (!f || typeof f.data !== "string" || !f.data) throw new Error("empty file");
  const file = new File(Paths.cache, safeName(f.name));
  if (file.exists) file.delete();
  file.create();
  file.write(f.data, { encoding: "base64" });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: f.mime, dialogTitle: file.name });
  }
}
