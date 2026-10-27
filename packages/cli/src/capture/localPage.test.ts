import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { safeFetch } from "./assetDownloader.js";
import {
  fetchLocalPageUrl,
  resolveLocalCaptureTarget,
  startLocalPageServer,
  type LocalPageServer,
} from "./localPage.js";

let base: string;
let site: string;

beforeAll(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "hf-local-page-")));
  site = join(base, "site");
  mkdirSync(join(site, "pages"), { recursive: true });
  writeFileSync(join(site, "index.html"), "<h1>home</h1>");
  writeFileSync(join(site, "pages", "about page.html"), "<h1>about</h1>");
  writeFileSync(join(site, "logo.png"), "png-bytes");
  writeFileSync(join(base, "secret.txt"), "outside the root");
  writeFileSync(join(base, "outside.html"), "<h1>outside</h1>");
  if (process.platform !== "win32") {
    symlinkSync(join(base, "secret.txt"), join(site, "link.txt"));
    symlinkSync(join(base, "outside.html"), join(site, "linked.html"));
  }
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("resolveLocalCaptureTarget", () => {
  it("accepts a path, a file:// URL or a directory, rooted at the file's directory", () => {
    const entry = join(site, "index.html");
    const expected = { root: site, entry, fileUrl: pathToFileURL(entry).href };
    expect(resolveLocalCaptureTarget(entry)).toEqual(expected);
    expect(resolveLocalCaptureTarget(pathToFileURL(entry).href)).toEqual(expected);
    expect(resolveLocalCaptureTarget(site)).toEqual(expected);
  });

  it("takes an explicit root that contains the file", () => {
    const entry = join(site, "pages", "about page.html");
    expect(resolveLocalCaptureTarget(entry, site).root).toBe(site);
    expect(resolveLocalCaptureTarget(entry).root).toBe(join(site, "pages"));
  });

  it("refuses a file outside the root and a missing file", () => {
    expect(() => resolveLocalCaptureTarget(join(site, "index.html"), join(site, "pages"))).toThrow(
      "outside the root",
    );
    expect(() => resolveLocalCaptureTarget(join(site, "missing.html"))).toThrow(
      "Local file not found",
    );
    expect(() => resolveLocalCaptureTarget("https://example.com/")).toThrow("Local file not found");
  });

  it.skipIf(process.platform === "win32")(
    "does not widen the default root to where a symlinked entry points",
    () => {
      expect(() => resolveLocalCaptureTarget(join(site, "linked.html"))).toThrow(
        "outside the root",
      );
    },
  );
});

describe("startLocalPageServer", () => {
  let server: LocalPageServer;

  beforeAll(async () => {
    const target = resolveLocalCaptureTarget(join(site, "pages", "about page.html"), site);
    server = await startLocalPageServer(target);
  });

  afterAll(() => server.close());

  it("serves the entry page and files inside the root", async () => {
    expect(server.url).toBe(`${server.origin}/pages/about%20page.html`);
    const page = await fetch(server.url);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<h1>about</h1>");
    expect(await (await fetch(`${server.origin}/logo.png`)).text()).toBe("png-bytes");
  });

  it.each([
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/pages/..%2f..%2fsecret.txt",
    "/missing.png",
  ])("answers 404 for %s", async (path) => {
    const response = await fetch(`${server.origin}${path}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it.skipIf(process.platform === "win32")("refuses a symlink that leaves the root", async () => {
    expect((await fetch(`${server.origin}/link.txt`)).status).toBe(404);
  });

  it("refuses methods other than GET and HEAD", async () => {
    expect((await fetch(server.url, { method: "POST" })).status).toBe(405);
  });

  it("lets the asset downloader read the active local origin, and only that origin", async () => {
    const response = await safeFetch(`${server.origin}/logo.png`);
    expect(await response?.text()).toBe("png-bytes");
    expect((await safeFetch(`${server.origin}/%2e%2e/secret.txt`))?.status).toBe(404);
    expect(fetchLocalPageUrl("http://127.0.0.1:1/logo.png")).toBeNull();
    expect(await safeFetch("http://127.0.0.1:1/logo.png")).toBeNull();
  });

  it("reads the active local origin from disk, so an environment proxy cannot intercept it", async () => {
    const networkFetch = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", networkFetch);
    try {
      const response = await safeFetch(`${server.origin}/pages/about%20page.html`);
      expect(response?.headers.get("content-type")).toContain("text/html");
      expect(await response?.text()).toBe("<h1>about</h1>");
      const head = await safeFetch(`${server.origin}/logo.png`, { method: "HEAD" });
      expect(head?.headers.get("content-type")).toBe("image/png");
      expect(await head?.text()).toBe("");
      expect(networkFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops answering for the origin once closed", async () => {
    const target = resolveLocalCaptureTarget(site);
    const closed = await startLocalPageServer(target);
    await closed.close();
    expect(fetchLocalPageUrl(`${closed.origin}/index.html`)).toBeNull();
    expect(await safeFetch(`${closed.origin}/index.html`)).toBeNull();
  });
});
