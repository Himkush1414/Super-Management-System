// @ts-check
// Downloads: the page fetched the file with the signed-in session (see
// src/injected.js) and sent it here. Save it in the app's cache and open
// it: on Android in the phone's viewer (PDF/CSV app) or the share sheet
// (WhatsApp, Drive, print); on iOS in the share sheet. Only the most
// recent download is kept on the phone.
import { Alert, Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";

/** FLAG_GRANT_READ_URI_PERMISSION: the viewer app may read this one file */
const GRANT_READ = 1;

/**
 * @param {{ name: string, mime: string, base64: string }} f
 * @returns {File}
 */
function save(f) {
  const dir = new Directory(Paths.cache, "downloads");
  // the previous download goes: no copies of company files pile up
  if (dir.exists) dir.delete();
  dir.create();
  const file = new File(dir, f.name);
  file.create();
  file.writeSync(f.base64, { encoding: "base64" });
  return file;
}

/** @param {File} file @param {string} mime */
async function share(file, mime) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("sharing unavailable");
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: file.name });
}

/** @param {File} file @param {string} mime */
async function openInViewer(file, mime) {
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: file.contentUri,
      type: mime,
      flags: GRANT_READ,
    });
  } catch {
    // no app on the phone opens this type: the share sheet still works
    await share(file, mime);
  }
}

/** @param {{ name: string, mime: string, base64: string }} f */
export async function saveAndOpenFile(f) {
  if (!f || typeof f.base64 !== "string" || !f.base64) throw new Error("empty file");
  const file = save(f);
  if (Platform.OS !== "android") {
    await share(file, f.mime);
    return;
  }
  await new Promise((resolve) => {
    const done = (/** @type {Promise<void>} */ p) => void p.catch(() => {}).finally(() => resolve(undefined));
    Alert.alert(
      "Downloaded",
      file.name,
      [
        { text: "Share", onPress: () => done(share(file, f.mime)) },
        { text: "Open", onPress: () => done(openInViewer(file, f.mime)) },
      ],
      { cancelable: true, onDismiss: () => resolve(undefined) },
    );
  });
}
