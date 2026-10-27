const UNIT_MS = { ms: 1, s: 1_000, m: 60_000 } as const;

/**
 * Reads a `--timeout` value as milliseconds. A bare number is milliseconds; `45s`, `2m` and
 * `45000ms` carry their unit. A bare value under 1000 is kept but warned about, since it is
 * almost always seconds typed where milliseconds are read.
 */
export function parseTimeoutMs(
  raw: unknown,
  fallback: number,
  warn: (message: string) => void = console.error,
): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const text = String(raw).trim();
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec(text);
  if (!match) {
    warn(`[hyperframes] --timeout "${text}" is not a duration; using ${fallback} ms.`);
    return fallback;
  }
  const unit = match[2]?.toLowerCase() as keyof typeof UNIT_MS | undefined;
  const ms = Math.round(Number(match[1]) * UNIT_MS[unit ?? "ms"]);
  if (ms <= 0) return fallback;
  if (!unit && ms < 1_000) {
    warn(`[hyperframes] --timeout ${ms} is ${ms} ms. Write ${ms}s for seconds.`);
  }
  return ms;
}
