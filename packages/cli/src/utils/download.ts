import { randomUUID } from "node:crypto";
import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { get as httpsGet } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadOptions {
  /** Abort after this many milliseconds without network activity. */
  timeoutMs?: number;
  /** Reject before writing more than this many response bytes. */
  maxBytes?: number;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  /** Aborting it destroys the request and removes the partial file. */
  signal?: AbortSignal;
}

/** Every redirect a host may reasonably answer with, not just the two we saw first. */
export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Where a redirect actually points.
 *
 * Split out because this is the part that was wrong, and it is the part that
 * can be checked without a socket: hosts answer with relative locations
 * (`/api/resolve-cache/...`) far more often than the original code assumed, and
 * handing that string back as a request target fails.
 */
export function redirectTarget(location: string, from: string): string {
  return new URL(location, from).toString();
}

/** Enough hops for a CDN handoff, few enough that a redirect loop still ends. */
const MAX_REDIRECTS = 10;

function removePartialFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Missing/locked partial files are handled by the next atomic download.
  }
}

function measureDownload(options: DownloadOptions, startBytes: number, totalBytes: number | null) {
  let receivedBytes = startBytes;
  let reportedAt = Date.now();
  options.onProgress?.(receivedBytes, totalBytes);
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength;
      if (options.maxBytes !== undefined && receivedBytes > options.maxBytes) {
        callback(new Error(`Download exceeded ${options.maxBytes} bytes`));
        return;
      }
      const now = Date.now();
      if (now - reportedAt >= 100) {
        options.onProgress?.(receivedBytes, totalBytes);
        reportedAt = now;
      }
      callback(null, chunk);
    },
  });
  return {
    stream,
    received: () => receivedBytes,
    complete: () => options.onProgress?.(receivedBytes, totalBytes),
  };
}

function getUrl(
  url: string,
  signal: AbortSignal | undefined,
  offset: number,
  onResponse: (res: IncomingMessage) => void,
): ClientRequest {
  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : undefined;
  if (!signal && !headers) return httpsGet(url, onResponse);
  return httpsGet(
    url,
    { ...(signal ? { signal } : {}), ...(headers ? { headers } : {}) },
    onResponse,
  );
}

function byteCount(value: string | undefined): number | null {
  const n = Number(value);
  return value !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Where a 206 body starts and the whole file's size, from `Content-Range: bytes start-end/total`. */
function contentRange(header: string | undefined): { start: number; total: number | null } | null {
  const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(header ?? "");
  return match
    ? { start: Number(match[1]), total: match[2] === "*" ? null : Number(match[2]) }
    : null;
}

/** One request chain; `state.received` holds the bytes in `tmp` even when it rejects. */
function downloadAttempt(
  url: string,
  tmp: string,
  state: { received: number },
  options: DownloadOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const offset = state.received;
  return new Promise((resolve, reject) => {
    const follow = (u: string, hops = 0) => {
      let activeResponse: IncomingMessage | undefined;
      let responseDiscarded = false;
      let responsePipelineStarted = false;
      let requestError: Error | undefined;
      let request: ClientRequest;
      try {
        request = getUrl(u, options.signal, offset, (res) => {
          activeResponse = res;
          if (res.statusCode && REDIRECT_CODES.has(res.statusCode)) {
            const location = res.headers.location;
            if (location) {
              responseDiscarded = true;
              res.destroy();
              if (hops >= MAX_REDIRECTS) {
                reject(
                  new Error(
                    `Download failed: more than ${MAX_REDIRECTS} redirects from ${url.split("?")[0]}`,
                  ),
                );
                return;
              }
              try {
                follow(redirectTarget(location, u), hops + 1);
              } catch (error) {
                reject(error);
              }
              return;
            }
          }
          const range = res.statusCode === 206 ? contentRange(res.headers["content-range"]) : null;
          const resumed = offset > 0 && range?.start === offset;
          if (res.statusCode !== 200 && !resumed) {
            responseDiscarded = true;
            res.destroy();
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const start = resumed ? offset : 0;
          const length = byteCount(res.headers["content-length"]);
          const total = resumed ? (range?.total ?? null) : length;
          state.received = start;
          const meter = measureDownload(options, start, total);
          const file = createWriteStream(tmp, { flags: resumed ? "a" : "w" });
          responsePipelineStarted = true;
          const transfer = pipeline(res, meter.stream, file);
          transfer
            .then(() => {
              state.received = meter.received();
              meter.complete();
              resolve();
            })
            .catch((err) => {
              state.received = meter.received();
              reject(requestError ?? err);
            });
        });
      } catch (error) {
        reject(error);
        return;
      }
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
      });
      request.on("error", (err) => {
        if (responseDiscarded) return;
        if (responsePipelineStarted) {
          requestError = err;
          activeResponse?.destroy(err);
          return;
        }
        reject(err);
      });
    };
    follow(url);
  });
}

/**
 * Download a file from a URL, following redirects.
 * Uses atomic write (download to .tmp, rename on success) to prevent
 * corrupt partial files from persisting in the cache on interruption.
 *
 * Location headers are resolved against the URL that sent them, because they
 * are frequently relative: a host answering 307 with `/api/resolve-cache/...`
 * is normal, and passing that string back as a request target is not.
 *
 * The timeout is per request, so it re-arms on each hop of a redirect chain
 * rather than budgeting the whole chain. A stalled socket is what it exists to
 * catch, and without it the CLI waits forever.
 *
 * Some networks stop delivering a large file at the same byte count on every
 * connection. When an attempt fails after making progress, the next one asks for
 * the rest with a Range header; it gives up only when an attempt brings nothing.
 */
export async function downloadFile(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const state = { received: 0 };
  for (;;) {
    const before = state.received;
    try {
      await downloadAttempt(url, tmp, state, options);
      renameSync(tmp, dest);
      return;
    } catch (error) {
      const overLimit = error instanceof Error && error.message.startsWith("Download exceeded");
      if (options.signal?.aborted || overLimit || state.received <= before) {
        removePartialFile(tmp);
        throw error;
      }
    }
  }
}
