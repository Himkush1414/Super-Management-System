/**
 * The browser's side of reading a document (lib/inventory/sheet-read.ts):
 * everything happens in this tab's memory. Nothing is uploaded, stored on
 * disk, kept in the browser's storage or logged; the bytes are dropped as
 * soon as the rows are read.
 */
import { SheetError, pdfTextItems, readSheet, deadline, LIMITS, type PdfJs, type ReadResult } from "@/lib/inventory/sheet-read";

/** Inflate a zip part with the browser's DecompressionStream, stopping at `maxOut` bytes. */
async function inflateRaw(data: Uint8Array, maxOut: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new SheetError("unsupported", "This browser can't open Word / Excel files. Update it, or use a PDF or CSV.");
  }
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream("deflate-raw" as CompressionFormat);
  } catch {
    throw new SheetError("unsupported", "This browser can't open Word / Excel files. Update it, or use a PDF or CSV.");
  }
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(ds).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOut) {
        await reader.cancel().catch(() => {});
        throw new SheetError("zip_bomb", "A part of the file is larger than it says.");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof SheetError) throw e;
    throw new SheetError("corrupt", "The file is damaged.");
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

let worker: Worker | null = null;

/** pdf.js, loaded only on the import page; its worker runs from this site. */
async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import("pdfjs-dist");
  if (!worker) {
    worker = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
  return pdfjs as unknown as PdfJs;
}

/** Stop pdf.js's worker (after a timeout, or when leaving the page). */
export function stopPdfWorker() {
  worker?.terminate();
  worker = null;
}

/**
 * Read a picked file: size first, then the bytes (in memory), then rows.
 * A hard time limit covers the whole read, including pdf.js's worker.
 */
export async function readPickedFile(file: File): Promise<ReadResult> {
  if (file.size > LIMITS.maxBytes) throw new SheetError("too_big", `The file is larger than ${LIMITS.maxBytes / 1024 / 1024} MB.`);
  if (file.size === 0) throw new SheetError("empty", "The file is empty.");
  const check = deadline(LIMITS.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stopPdfWorker();
      reject(new SheetError("timeout", "The file took too long to read."));
    }, LIMITS.timeoutMs + 500);
  });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await Promise.race([
      readSheet(bytes, { inflate: inflateRaw, pdfItems: async (b, c) => pdfTextItems(await loadPdfJs(), b, c) }, check),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A message for the screen: never the file's name or content. */
export function readError(e: unknown): string {
  if (e instanceof SheetError) return e.message;
  return "The file couldn't be read. Use PDF (with text), Word (.docx), Excel (.xlsx) or CSV, or enter the balances by hand.";
}
