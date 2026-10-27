import { request as httpRequest } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

/** The proxy capture sends its downloads through, or null. Opt-in: only with NODE_USE_ENV_PROXY=1. */
export function egressProxy(
  protocol: "http:" | "https:",
  env: NodeJS.ProcessEnv = process.env,
): URL | null {
  if (env.NODE_USE_ENV_PROXY !== "1") return null;
  const names =
    protocol === "https:" ? ["HTTPS_PROXY", "https_proxy"] : ["HTTP_PROXY", "http_proxy"];
  const configured = names.map((name) => env[name]).find(Boolean);
  if (!configured) return null;
  const proxy = new URL(configured);
  if (proxy.protocol !== "http:") throw new Error("Capture supports only an http:// egress proxy");
  return proxy;
}

/** The Proxy-Authorization header for credentials in the proxy URL, if any. */
export function proxyAuthorization(proxy: URL): Record<string, string> {
  if (!proxy.username && !proxy.password) return {};
  const user = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { "proxy-authorization": `Basic ${Buffer.from(user).toString("base64")}` };
}

/** A tunnel to host:port through the proxy; rejects unless the proxy answers 200. */
export function openTunnel(
  proxy: URL,
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<Duplex> {
  return new Promise<Duplex>((resolve, reject) => {
    const req = httpRequest({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}`, ...proxyAuthorization(proxy) },
      agent: false,
      signal,
    });
    req.once("connect", (response, socket: Socket) => {
      if (response.statusCode === 200) return resolve(socket);
      socket.destroy();
      reject(new Error(`Capture egress proxy refused the tunnel (${response.statusCode})`));
    });
    req.once("error", reject);
    req.end();
  });
}
