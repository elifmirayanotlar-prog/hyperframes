let pageCrashed = false;

/** Puppeteer emits "error" on a page only when its renderer crashes, most often out of memory. */
export function notePageCrash(): void {
  pageCrashed = true;
}

// One flag per process: after a crash, a long-lived server labels every later page close as the crash.
const CLOSED_PAGE = /Target closed|detached Frame|Session closed/;

export function normalizeErrorMessage(error: unknown): string {
  const message = messageOf(error);
  return pageCrashed && CLOSED_PAGE.test(message)
    ? `The browser page crashed, most likely out of memory: ${message}`
    : message;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(error) ?? `{${Object.keys(error).join(", ")}}`;
    } catch {
      try {
        return `{${Object.keys(error as object).join(", ")}}`;
      } catch {
        /* truly opaque object */
      }
    }
  }
  return String(error ?? "unknown error");
}

const PROTOCOL_TIMEOUT_ADVICE =
  / Increase the 'protocolTimeout' setting in launch\/connect calls[^.]*\./;

export async function atStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && !error.message.includes(` (while ${step})`)) {
      error.message = error.message.replace(PROTOCOL_TIMEOUT_ADVICE, "") + ` (while ${step})`;
    }
    throw error;
  }
}
