// Module resolution for tests that load app code (lib/**) directly in node:
// "@/x" -> <repo>/x(.ts|.tsx|/index.ts), and "server-only" -> an empty module
// (it only guards against bundling into the browser). Test-only.
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true, format: "module" };
  if (specifier.startsWith("@/")) {
    const base = join(REPO, specifier.slice(2));
    for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      let file = false;
      try {
        file = statSync(p).isFile();
      } catch {
        // not this one
      }
      if (file) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
