import { format, stripVTControlCharacters } from "node:util";
import { CliUsageError, type CommandResult } from "./commandResult.js";

export interface CliErrorBody {
  code: string;
  message: string;
  hint?: string;
}

export interface JsonFailure {
  ok: false;
  error: CliErrorBody;
}

/** The `--json` failure shape every command shares; spread it to add command-specific fields. */
export function jsonFailure(code: string, message: string, hint?: string): JsonFailure {
  return { ok: false, error: hint ? { code, message, hint } : { code, message } };
}

export function writeJsonFailure(body: CliErrorBody): void {
  process.stdout.write(`${JSON.stringify({ ok: false, error: body })}\n`);
}

/**
 * Records whether anything reached stdout and keeps what went to stderr, so a failed `--json`
 * run that printed nothing can still answer with an envelope that says why. Bun's console
 * writes past process.stdout.write, so the console methods are watched too.
 */
export function watchOutput(): { wroteStdout: () => boolean; stderrText: () => string } {
  let wrote = false;
  let stderr = "";
  let inConsole = false;
  const keep = (text: string) => {
    stderr = (stderr + text).slice(-4000);
  };
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((...args: Parameters<typeof stdoutWrite>) => {
    wrote = true;
    return stdoutWrite(...args);
  }) as typeof process.stdout.write;
  process.stderr.write = ((...args: Parameters<typeof stderrWrite>) => {
    if (!inConsole)
      keep(args[0] instanceof Uint8Array ? Buffer.from(args[0]).toString() : String(args[0]));
    return stderrWrite(...args);
  }) as typeof process.stderr.write;
  for (const name of ["log", "info", "debug", "dir", "table"] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      wrote = true;
      original(...args);
    };
  }
  for (const name of ["error", "warn"] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      keep(`${format(...args)}\n`);
      inConsole = true;
      try {
        original(...args);
      } finally {
        inConsole = false;
      }
    };
  }
  return {
    wroteStdout: () => wrote,
    stderrText: () =>
      stripVTControlCharacters(stderr)
        .split("\n")
        .map((line) => line.replace(/^[\s✗│◇◆]+/u, "").trim())
        .filter(Boolean)
        .join(" ")
        .slice(-1000),
  };
}

/** The envelope for a failed run: a usage error speaks for itself, anything else by what it printed. */
export function jsonErrorBody(
  error: unknown,
  result: CommandResult,
  stderrText: string,
): CliErrorBody {
  if (error instanceof CliUsageError) {
    const body = { code: error.code, message: error.message };
    return error.hint ? { ...body, hint: error.hint } : body;
  }
  const code = result.kind === "usage_error" ? "usage_error" : "runtime_error";
  const own = error instanceof Error && !("result" in error) ? error.message : "";
  return { code, message: stripVTControlCharacters(own) || stderrText || "Command failed" };
}
