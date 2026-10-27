/**
 * One reader for every CLI flag whose value is JSON. The value is inline JSON
 * (starts with `{` or `[`), `-` for stdin, or a file path. PowerShell strips the
 * quotes from inline JSON passed to a `.cmd` launcher, so Windows callers need the
 * file or stdin form.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface JsonFlagIO {
  readFile: (path: string) => string;
  readStdin: () => string;
}

const defaultIO: JsonFlagIO = {
  readFile: (path) => readFileSync(resolve(path), "utf8"),
  readStdin: () => readFileSync(0, "utf8"),
};

export class JsonFlagReadError extends Error {
  constructor(
    readonly path: string,
    readonly cause: string,
  ) {
    super(`${path}: ${cause}`);
  }
}

function isJsonScalar(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function readJsonFlagText(value: string, partialIo: Partial<JsonFlagIO> = {}): string {
  const io = { ...defaultIO, ...partialIo };
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || isJsonScalar(trimmed)) return value;
  const source = trimmed === "-" ? "stdin" : value;
  try {
    return trimmed === "-" ? io.readStdin() : io.readFile(value);
  } catch (error: unknown) {
    throw new JsonFlagReadError(source, errorText(error));
  }
}

export const inlineJsonHint = (flag: string) =>
  `PowerShell strips the quotes from inline JSON; pass a file (${flag} payload.json) or pipe it (${flag} -)`;

/** The parsed value of a JSON flag; throws a plain Error naming the flag and, for inline JSON, the Windows fix. */
export function readJsonFlag(flag: string, value: string, io?: Partial<JsonFlagIO>): unknown {
  let text: string;
  try {
    text = readJsonFlagText(value, io);
  } catch (error: unknown) {
    if (!(error instanceof JsonFlagReadError)) throw error;
    throw new Error(`Could not read ${flag}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    const hint = /^\s*[{[]/.test(text) ? ` (${inlineJsonHint(flag)})` : "";
    throw new Error(`Could not parse ${flag} JSON: ${errorText(error)}${hint}`);
  }
}
