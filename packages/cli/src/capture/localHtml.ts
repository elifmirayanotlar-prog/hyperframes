import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const MAX_BYTES = 10 * 1024 * 1024;

/** The text of a local HTML page for `capture --file`. A page given this way is the only local read capture makes. */
export function readLocalHtml(path: string): string {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats?.isFile()) throw new Error(`--file must name an existing file: ${path}`);
  if (![".html", ".htm"].includes(extname(path).toLowerCase())) {
    throw new Error("--file takes an .html or .htm file");
  }
  if (stats.size > MAX_BYTES) throw new Error("--file pages are limited to 10 MB");
  return readFileSync(path, "utf8");
}
