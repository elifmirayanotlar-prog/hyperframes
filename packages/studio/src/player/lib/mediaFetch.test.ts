import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaFetchError, mediaUrlSourceOptions, reportMediaFetchFailure } from "./mediaFetch";

const URL_WITH_PATH = "http://127.0.0.1:5190/api/projects/demo/preview/clips/take-1.mp4";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mediaUrlSourceOptions", () => {
  it("turns a network failure into a typed error without the URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { fetchFn } = mediaUrlSourceOptions("probe");

    const error = await fetchFn(URL_WITH_PATH).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MediaFetchError);
    expect(error).toMatchObject({ reader: "probe", status: null, code: "TypeError" });
    expect(String((error as Error).message)).not.toContain("take-1");
  });

  it("names the network code when the failure carries one", async () => {
    const failure = Object.assign(new TypeError("fetch failed"), { cause: { code: "EBUSY" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    const error = await mediaUrlSourceOptions("thumbnail")
      .fetchFn(URL_WITH_PATH)
      .catch((e) => e);

    expect(error).toMatchObject({ reader: "thumbnail", code: "EBUSY" });
  });

  it("turns an HTTP error status into a typed error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));

    const error = await mediaUrlSourceOptions("probe")
      .fetchFn(URL_WITH_PATH)
      .catch((e) => e);

    expect(error).toMatchObject({
      status: 403,
      message: "probe range fetch failed: HTTP 403 after 0 retries",
    });
  });

  it("lets a cancellation through untouched", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(mediaUrlSourceOptions("probe").fetchFn(URL_WITH_PATH)).rejects.toBe(abort);
  });

  it("retries a network failure twice, then gives up and records the retries", () => {
    const { getRetryDelay } = mediaUrlSourceOptions("probe");
    const failure = new MediaFetchError("probe", null, "TypeError");

    expect([1, 2, 3].map((attempt) => getRetryDelay(attempt, failure))).toEqual([0.5, 1, null]);
    expect(failure).toMatchObject({
      retries: 2,
      message: "probe range fetch failed: network TypeError after 2 retries",
    });
  });

  it("gives up on a body that breaks mid-read with the typed error, through a real mediabunny read", async () => {
    const brokenBody = () =>
      new Response(
        new ReadableStream({
          pull: (controller) => controller.error(new TypeError("network error")),
        }),
        {
          status: 206,
          headers: { "Content-Range": "bytes 0-65535/1000000", "Content-Length": "65536" },
        },
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => brokenBody()),
    );
    vi.useFakeTimers();
    const mb = await import("mediabunny");
    const runnerListeners = process.listeners("unhandledRejection");
    const unhandled: unknown[] = [];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => unhandled.push(reason));
    try {
      const input = new mb.Input({
        source: new mb.UrlSource(URL_WITH_PATH, mediaUrlSourceOptions("thumbnail")),
        formats: mb.ALL_FORMATS,
      });
      const read = input.getDurationFromMetadata().catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await read;
      input.dispose();
      await vi.runAllTimersAsync();

      expect(error).toMatchObject({
        name: "MediaFetchError",
        message: "thumbnail range fetch failed: network TypeError after 2 retries",
      });
      for (const reason of unhandled) expect(reason).toBeInstanceOf(MediaFetchError);
    } finally {
      vi.useRealTimers();
      process.removeAllListeners("unhandledRejection");
      for (const listener of runnerListeners) process.on("unhandledRejection", listener);
    }
  });

  it("fails a read stalled mid-body once its reader is disposed and its reads cancelled", async () => {
    // Like fetch, the stub ends its body when the request's signal aborts, and not before.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        let sent = false;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              return controller.enqueue(new Uint8Array(16));
            }
            return new Promise<void>((resolve) => {
              const end = () => {
                controller.error(init?.signal?.reason);
                resolve();
              };
              init?.signal?.addEventListener("abort", end, { once: true });
            });
          },
        });
        const headers = { "Content-Range": "bytes 0-999999/1000000", "Content-Length": "1000000" };
        return new Response(body, { status: 206, headers });
      }),
    );
    const mb = await import("mediabunny");
    const runnerListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", () => {});
    try {
      const options = mediaUrlSourceOptions("thumbnail");
      const input = new mb.Input({
        source: new mb.UrlSource(URL_WITH_PATH, options),
        formats: mb.ALL_FORMATS,
      });
      let settled = false;
      const read = input.getDurationFromMetadata().finally(() => (settled = true));
      read.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);

      input.dispose();
      options.cancelReads();
      await expect(read).rejects.toBeDefined();
      // The cancelled read-ahead's own rejection lands a turn later; keep it out of the next test.
      await new Promise(setImmediate);
      await new Promise(setImmediate);
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of runnerListeners) process.on("unhandledRejection", listener);
    }
  });

  it("counts mid-stream read failures, which always arrive as attempt 1", () => {
    const { getRetryDelay } = mediaUrlSourceOptions("thumbnail");
    const readError = new TypeError("network error");

    expect([1, 1, 1].map((attempt) => getRetryDelay(attempt, readError))).toEqual([0.5, 1, null]);
  });

  it("forgives failures once a read succeeds, so a long-lived reader keeps each clip's retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("frame", { status: 206 })),
    );
    const { fetchFn, getRetryDelay } = mediaUrlSourceOptions("thumbnail");
    const readError = new TypeError("network error");
    for (let clip = 0; clip < 5; clip++) {
      expect(getRetryDelay(1, readError)).toBe(0.5);
      const response = await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=0-" } });
      await response.body!.getReader().read();
    }

    expect([1, 1, 1].map((attempt) => getRetryDelay(attempt, readError))).toEqual([0.5, 1, null]);
  });

  it("does not retry a client error status", () => {
    const failure = new MediaFetchError("probe", 404, null);

    expect(mediaUrlSourceOptions("probe").getRetryDelay(1, failure)).toBeNull();
    expect(failure.retries).toBe(0);
  });

  // mediabunny rethrows a failed read-ahead nobody awaits "so it doesn't get swallowed": that copy is typed too.
  it("fails a real mediabunny read, and its unawaited read-ahead, with the typed error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const mb = await import("mediabunny");
    const runnerListeners = process.listeners("unhandledRejection");
    const unhandled: unknown[] = [];
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", (reason) => unhandled.push(reason));
    try {
      const input = new mb.Input({
        source: new mb.UrlSource(URL_WITH_PATH, mediaUrlSourceOptions("probe")),
        formats: mb.ALL_FORMATS,
      });
      const error = await input.getDurationFromMetadata().catch((e: unknown) => e);
      input.dispose();
      await new Promise(setImmediate);

      expect(error).toMatchObject({ name: "MediaFetchError", status: 404, retries: 0 });
      expect(unhandled.length).toBeGreaterThan(0);
      for (const reason of unhandled) expect(reason).toBeInstanceOf(MediaFetchError);
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of runnerListeners) process.on("unhandledRejection", listener);
    }
  });
});

describe("thumbnail reads", () => {
  // A 206 answering each request, with its Content-Range readable or (cross-origin, unexposed) hidden.
  function rangeServer(answers: ("readable" | "hidden" | "whole" | { start: number })[]) {
    const ranges: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const range = new Headers(init?.headers).get("Range");
        ranges.push(range);
        const answer = answers[ranges.length - 1] ?? "readable";
        const start = typeof answer === "object" ? answer.start : Number(/\d+/.exec(range ?? "0"));
        const headers =
          answer === "hidden" ? {} : { "Content-Range": `bytes ${start}-9999999/10000000` };
        return new Response("", { status: answer === "whole" ? 200 : 206, headers });
      }),
    );
    return ranges;
  }
  const BOUND = 512 * 1024;

  it("bounds an open-ended thumbnail range once this reader has read a Content-Range", async () => {
    const ranges = rangeServer(["readable"]);
    const { fetchFn } = mediaUrlSourceOptions("thumbnail");
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=0-" } });
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=1000-" } });
    await fetchFn(URL_WITH_PATH, { headers: new Headers({ Range: "bytes=0-99" }) });

    // The first stays open-ended: without a readable Content-Range mediabunny sizes the file from it.
    expect(ranges).toEqual(["bytes=0-", `bytes=1000-${1000 + BOUND - 1}`, "bytes=0-99"]);
  });

  it("never bounds a reader once an answer hid its Content-Range", async () => {
    const ranges = rangeServer(["hidden", "readable"]);
    const { fetchFn } = mediaUrlSourceOptions("thumbnail");
    for (const start of [0, 1000, 2000]) {
      await fetchFn(URL_WITH_PATH, { headers: { Range: `bytes=${start}-` } });
    }

    expect(ranges).toEqual(["bytes=0-", "bytes=1000-", "bytes=2000-"]);
  });

  it("does not trust a Content-Range for a range it did not ask for", async () => {
    const ranges = rangeServer([{ start: 4096 }]);
    const { fetchFn } = mediaUrlSourceOptions("thumbnail");
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=0-" } });
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=1000-" } });

    expect(ranges).toEqual(["bytes=0-", "bytes=1000-"]);
  });

  it("does not trust a whole-file answer, whatever its headers say", async () => {
    const ranges = rangeServer(["whole"]);
    const { fetchFn } = mediaUrlSourceOptions("thumbnail");
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=0-" } });
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=1000-" } });

    expect(ranges).toEqual(["bytes=0-", "bytes=1000-"]);
  });

  it("never bounds a probe's range", async () => {
    const ranges = rangeServer(["readable"]);
    const { fetchFn } = mediaUrlSourceOptions("probe");
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=0-" } });
    await fetchFn(URL_WITH_PATH, { headers: { Range: "bytes=1000-" } });

    expect(ranges).toEqual(["bytes=0-", "bytes=1000-"]);
  });

  it("keeps a thumbnail reader's cache at 16 MiB, and a probe's at mediabunny's default", () => {
    expect(mediaUrlSourceOptions("thumbnail")).toMatchObject({ maxCacheSize: 16 * 1024 * 1024 });
    expect(mediaUrlSourceOptions("probe")).not.toHaveProperty("maxCacheSize");
  });
});

describe("reportMediaFetchFailure", () => {
  it("writes one scrubbed line for a typed failure and nothing for anything else", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new MediaFetchError("thumbnail", null, "TypeError");
    failure.setRetries(2);

    reportMediaFetchFailure(failure);
    reportMediaFetchFailure(new Error("Video source has no decodable video track"));

    expect(warn.mock.calls).toEqual([
      ["[Studio] thumbnail range fetch failed: network TypeError after 2 retries"],
    ]);
  });
});
