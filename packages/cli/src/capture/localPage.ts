import { createReadStream, realpathSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface LocalCaptureTarget {
  /** Real path of the directory the page may read from. */
  root: string;
  /** Real path of the HTML file to open. */
  entry: string;
  /** `file://` URL of the entry, reported as the capture source. */
  fileUrl: string;
}

export interface LocalPageServer {
  origin: string;
  /** Loopback URL of the entry page. */
  url: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

const activeOrigins = new Set<string>();

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!!rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolves a local HTML file (path or `file://` URL) or a directory's `index.html` to a capture
 * target. The entry must lie inside `root` (default: its directory).
 */
export function resolveLocalCaptureTarget(target: string, root?: string): LocalCaptureTarget {
  const path = target.startsWith("file:") ? fileURLToPath(target) : target;
  let entry: string;
  try {
    entry = realpathSync(resolve(path));
    if (statSync(entry).isDirectory()) entry = realpathSync(join(entry, "index.html"));
  } catch {
    throw new Error(`Local file not found: ${target}`);
  }
  if (!statSync(entry).isFile()) throw new Error(`Local capture target is not a file: ${target}`);
  let rootPath: string;
  try {
    rootPath = realpathSync(resolve(root ?? dirname(entry)));
  } catch {
    throw new Error(`Local capture root not found: ${root}`);
  }
  if (!statSync(rootPath).isDirectory()) {
    throw new Error(`Local capture root is not a directory: ${root}`);
  }
  if (!isInside(rootPath, entry)) {
    throw new Error(`Local capture target ${entry} is outside the root ${rootPath}`);
  }
  return { root: rootPath, entry, fileUrl: pathToFileURL(entry).href };
}

async function servedFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(root, `.${decoded}`);
  if (!isInside(root, candidate)) return null;
  try {
    // Symlinks are followed, so the containment check must run on the real path.
    const real = await realpath(candidate);
    if (!isInside(root, real) || !(await stat(real)).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

function end(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Content-Length": 0, Connection: "close" });
  response.end();
}

/** Serves only regular files whose real path lies inside `target.root`, on a loopback port. */
export async function startLocalPageServer(target: LocalCaptureTarget): Promise<LocalPageServer> {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") return end(response, 405);
      const pathname = new URL(request.url ?? "/", "http://local").pathname;
      const file = await servedFile(target.root, pathname);
      if (!file) return end(response, 404);
      const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      if (request.method === "HEAD") return response.end();
      const stream = createReadStream(file);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    })().catch(() => response.destroy());
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local page server did not bind");
  const origin = `http://127.0.0.1:${address.port}`;
  const entryPath = relative(target.root, target.entry).split(sep).map(encodeURIComponent);
  activeOrigins.add(origin);
  let closing: Promise<void> | undefined;
  return {
    origin,
    url: `${origin}/${entryPath.join("/")}`,
    close() {
      closing ??= new Promise<void>((resolveClose) => {
        activeOrigins.delete(origin);
        server.close(() => resolveClose());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

/** Fetches a URL on an active local page server directly; null for every other URL. */
export function fetchLocalPageUrl(url: string, init?: RequestInit): Promise<Response> | null {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  if (!activeOrigins.has(origin)) return null;
  return fetch(url, { ...init, redirect: "manual" });
}
