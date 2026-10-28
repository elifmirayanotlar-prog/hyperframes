export type MediaReader = "probe" | "thumbnail";

const describe = (
  reader: MediaReader,
  status: number | null,
  code: string | null,
  retries: number,
) =>
  `${reader} range fetch failed: ${status === null ? `network ${code}` : `HTTP ${status}`} after ${retries} retries`;

/** A media range fetch that gave up: which reader, the HTTP status or network code, and the retries. Never the URL. */
export class MediaFetchError extends Error {
  override readonly name = "MediaFetchError";
  retries = 0;

  constructor(
    readonly reader: MediaReader,
    readonly status: number | null,
    readonly code: string | null,
    /** The byte the failed answer started at: its retry budget is kept per start. */
    readonly start: number | null = null,
  ) {
    super(describe(reader, status, code, 0));
  }

  setRetries(retries: number): void {
    this.retries = retries;
    this.message = describe(this.reader, this.status, this.code, retries);
  }
}

const MAX_RETRIES = 2;
// mediabunny asks for `bytes=N-` and cancels once it has its target, by when a local server has
// streamed megabytes past it. Bounded, a short answer makes mediabunny ask again from where it stopped,
// but only if it read the file's size from a Content-Range: see rangesReadable.
const THUMBNAIL_RANGE_BYTES = 512 * 1024;
// A pooled thumbnail reader outlives its clip (thumbnailSourcePool): a quarter of mediabunny's 64 MiB default.
const THUMBNAIL_READ_CACHE_BYTES = 16 * 1024 * 1024;

const rangeStart = (init: RequestInit | undefined, closed: boolean) =>
  (closed ? /^bytes=(\d+)-\d*$/ : /^bytes=(\d+)-$/).exec(
    new Headers(init?.headers).get("Range") ?? "",
  )?.[1];

function boundedRange(init: RequestInit | undefined): RequestInit | undefined {
  const start = rangeStart(init, false);
  if (start === undefined) return init;
  const headers = new Headers(init?.headers);
  headers.set("Range", `bytes=${start}-${Number(start) + THUMBNAIL_RANGE_BYTES - 1}`);
  return { ...init, headers };
}

/**
 * Whether this answer shows the range asked for. Without a readable Content-Range, which a
 * cross-origin server hides unless it lists it in Access-Control-Expose-Headers, mediabunny takes
 * the answer's Content-Length as running to the end of the file, so a bounded answer would end it.
 */
function rangesReadable(init: RequestInit | undefined, response: Response): boolean {
  const asked = rangeStart(init, true);
  const shown = /^bytes (\d+)-\d+\/\d+$/.exec(response.headers.get("Content-Range") ?? "")?.[1];
  return response.status === 206 && asked !== undefined && shown === asked;
}

const isAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === "AbortError";

function networkCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === "string") return cause.code;
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "unknown";
}

const typedFailure = (reader: MediaReader, error: unknown, start: number) =>
  isAbort(error) ? error : new MediaFetchError(reader, null, networkCode(error), start);

/** The body, failing a broken read with a MediaFetchError: mediabunny rethrows a body error as-is. */
function typedBody(
  reader: MediaReader,
  body: ReadableStream<Uint8Array>,
  start: number,
): ReadableStream<Uint8Array> {
  const source = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) return controller.close();
        controller.enqueue(value);
      } catch (error) {
        controller.error(typedFailure(reader, error, start));
      }
    },
    cancel: (reason) => source.cancel(reason),
  });
}

/** The answer to one range request, or the typed failure of it, which carries the start asked for. */
async function typedFetch(
  reader: MediaReader,
  input: RequestInfo | URL,
  sent: RequestInit,
  asked: number,
): Promise<Response> {
  let response: Response;
  try {
    // oxlint-disable-next-line no-restricted-globals -- a media read, on the media's sockets like mediabunny's own
    response = await fetch(input, sent);
  } catch (error) {
    throw typedFailure(reader, error, asked);
  }
  if (!response.ok) throw new MediaFetchError(reader, response.status, null, asked);
  return response;
}

/** The answer with its body typed; a 200 answers from byte 0, whatever start was asked. */
function typedResponse(reader: MediaReader, response: Response, asked: number): Response {
  if (!response.body) return response;
  const { status, statusText, headers } = response;
  const body = typedBody(reader, response.body, status === 206 ? asked : 0);
  return new Response(body, { status, statusText, headers });
}

/**
 * Options for a mediabunny `UrlSource`. Its default retries a same-origin network failure
 * forever and logs a bare `TypeError` each time; these retry twice and fail with a MediaFetchError.
 */
export function mediaUrlSourceOptions(reader: MediaReader) {
  // Failures per start byte: a resume asks for a new start and gets its own budget, while asking for the
  // same start again (a server that ignores Range, a region that keeps failing) uses it up, whatever else
  // this reader reads meanwhile. A 200 answers from byte 0, whatever start was asked.
  const failures = new Map<number | null, number>();
  // Disposing an Input leaves a read stalled mid-body waiting for good; aborting its fetch ends it.
  const reads = new AbortController();
  // Thumbnail ranges are bounded only after this reader read a Content-Range, and never once one was hidden.
  let ranges: "unknown" | "readable" | "hidden" = reader === "thumbnail" ? "unknown" : "hidden";
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const bounded = ranges === "readable" ? boundedRange(init) : init;
    const signals = [reads.signal, ...(init?.signal ? [init.signal] : [])];
    const sent = { ...bounded, signal: AbortSignal.any(signals) };
    const asked = Number(rangeStart(sent, true) ?? 0);
    const response = await typedFetch(reader, input, sent, asked);
    if (ranges !== "hidden") ranges = rangesReadable(sent, response) ? "readable" : "hidden";
    return typedResponse(reader, response, asked);
  };
  // mediabunny passes 1 for every failed mid-stream read, so it counts here instead.
  const getRetryDelay = (_previousAttempts: number, error: unknown): number | null => {
    const start = error instanceof MediaFetchError ? error.start : null;
    const failed = failures.get(start) ?? 0;
    const clientError =
      error instanceof MediaFetchError && error.status !== null && error.status < 500;
    if (error instanceof MediaFetchError) error.setRetries(failed);
    if (clientError || failed >= MAX_RETRIES) return null;
    failures.set(start, failed + 1);
    return 0.5 * (failed + 1);
  };
  /** Fails every read this source has in flight. Call it after disposing the Input reading through it. */
  const cancelReads = () => reads.abort(new DOMException("Media reads cancelled", "AbortError"));
  if (reader === "probe") return { fetchFn, getRetryDelay, cancelReads };
  return { fetchFn, getRetryDelay, cancelReads, maxCacheSize: THUMBNAIL_READ_CACHE_BYTES };
}

export function reportMediaFetchFailure(error: unknown): void {
  if (!(error instanceof MediaFetchError)) return;
  console.warn(`[Studio] ${error.message}`);
}
