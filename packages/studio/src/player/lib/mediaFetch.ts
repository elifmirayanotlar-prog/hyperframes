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

const typedFailure = (reader: MediaReader, error: unknown) =>
  isAbort(error) ? error : new MediaFetchError(reader, null, networkCode(error));

/** The body, failing a broken read with a MediaFetchError: mediabunny rethrows a body error as-is. */
function typedBody(
  reader: MediaReader,
  body: ReadableStream<Uint8Array>,
  onBytes: () => void,
): ReadableStream<Uint8Array> {
  const source = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) return controller.close();
        onBytes();
        controller.enqueue(value);
      } catch (error) {
        controller.error(typedFailure(reader, error));
      }
    },
    cancel: (reason) => source.cancel(reason),
  });
}

/**
 * Options for a mediabunny `UrlSource`. Its default retries a same-origin network failure
 * forever and logs a bare `TypeError` each time; these retry twice and fail with a MediaFetchError.
 */
export function mediaUrlSourceOptions(reader: MediaReader) {
  let failures = 0;
  // Thumbnail ranges are bounded only after this reader read a Content-Range, and never once one was hidden.
  let ranges: "unknown" | "readable" | "hidden" = reader === "thumbnail" ? "unknown" : "hidden";
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sent = ranges === "readable" ? boundedRange(init) : init;
    let response: Response;
    try {
      // oxlint-disable-next-line no-restricted-globals -- a media read, on the media's sockets like mediabunny's own
      response = await fetch(input, sent);
    } catch (error) {
      throw typedFailure(reader, error);
    }
    if (!response.ok) throw new MediaFetchError(reader, response.status, null);
    if (ranges !== "hidden") ranges = rangesReadable(sent, response) ? "readable" : "hidden";
    if (!response.body) return response;
    const { status, statusText, headers } = response;
    const body = typedBody(reader, response.body, () => (failures = 0));
    return new Response(body, { status, statusText, headers });
  };
  // Consecutive failures, so a pooled reader keeps a clip's retries however many clips it served:
  // bytes arriving forgive the failures before them. mediabunny passes 1 for every failed mid-stream read.
  const getRetryDelay = (_previousAttempts: number, error: unknown): number | null => {
    const clientError =
      error instanceof MediaFetchError && error.status !== null && error.status < 500;
    if (error instanceof MediaFetchError) error.setRetries(failures);
    if (clientError || failures >= MAX_RETRIES) return null;
    failures++;
    return 0.5 * failures;
  };
  if (reader === "probe") return { fetchFn, getRetryDelay };
  return { fetchFn, getRetryDelay, maxCacheSize: THUMBNAIL_READ_CACHE_BYTES };
}

export function reportMediaFetchFailure(error: unknown): void {
  if (!(error instanceof MediaFetchError)) return;
  console.warn(`[Studio] ${error.message}`);
}
