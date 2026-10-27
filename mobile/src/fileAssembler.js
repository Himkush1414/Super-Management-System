// @ts-check
// Puts a downloaded file back together from the pieces the page sends
// (file-start, file-chunk…, file-end; see src/injected.js). Pure, so it
// runs under `node --test`.

/** Larger files are refused rather than held in memory. */
const MAX_BASE64 = 60 * 1024 * 1024; // ≈ 45 MB of file

/** @param {string} name */
function safeName(name) {
  const clean = String(name || "download")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return clean || "download";
}

function createAssembler() {
  /** @type {Map<number, { parts: string[], size: number }>} */
  const jobs = new Map();
  return {
    /** @param {unknown} id */
    start(id) {
      if (typeof id !== "number") return;
      jobs.set(id, { parts: [], size: 0 });
    },
    /**
     * @param {any} msg file-chunk message
     * @returns {boolean} false when the piece is refused (the job is dropped)
     */
    chunk(msg) {
      const job = jobs.get(msg?.id);
      if (!job) return false;
      const ok =
        Number.isInteger(msg.i) && Number.isInteger(msg.n) && msg.i >= 0 && msg.i < msg.n && typeof msg.data === "string";
      if (!ok || job.size + msg.data.length > MAX_BASE64) {
        jobs.delete(msg.id);
        return false;
      }
      job.parts[msg.i] = msg.data;
      job.size += msg.data.length;
      return true;
    },
    /**
     * @param {any} msg file-end message
     * @returns {{ name: string, mime: string, base64: string } | null} null when pieces are missing
     */
    end(msg) {
      const job = jobs.get(msg?.id);
      jobs.delete(msg?.id);
      if (!job || !Number.isInteger(msg.chunks) || msg.chunks < 1 || job.parts.length !== msg.chunks) return null;
      for (let i = 0; i < msg.chunks; i++) if (typeof job.parts[i] !== "string") return null;
      const mime = typeof msg.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(msg.mime) ? msg.mime : "application/octet-stream";
      return { name: safeName(msg.name), mime, base64: job.parts.join("") };
    },
    /** @param {unknown} id */
    drop(id) {
      jobs.delete(/** @type {number} */ (id));
    },
    get pending() {
      return jobs.size;
    },
  };
}

module.exports = { createAssembler, safeName, MAX_BASE64 };
