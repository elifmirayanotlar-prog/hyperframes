export function normalizeErrorMessage(error: unknown): string {
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

export async function atStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && !error.message.includes(` (while ${step})`)) {
      error.message += ` (while ${step})`;
    }
    throw error;
  }
}
