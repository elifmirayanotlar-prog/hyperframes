import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startCaptureProxy, LOCAL_DOCUMENT_URL } from "./captureProxy.js";
import { egressProxy } from "./egressProxy.js";
import { publicRequest } from "./publicNetwork.js";

describe("egressProxy", () => {
  it("is off unless NODE_USE_ENV_PROXY=1", () => {
    expect(egressProxy("https:", { HTTPS_PROXY: "http://p:3128" })).toBeNull();
    expect(
      egressProxy("https:", { NODE_USE_ENV_PROXY: "0", HTTPS_PROXY: "http://p:3128" }),
    ).toBeNull();
  });

  it("picks the proxy for the target's scheme, upper or lower case", () => {
    const env = { NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://a:1", https_proxy: "http://b:2" };
    expect(egressProxy("http:", env)?.host).toBe("a:1");
    expect(egressProxy("https:", env)?.host).toBe("b:2");
    expect(egressProxy("https:", { NODE_USE_ENV_PROXY: "1" })).toBeNull();
  });

  it("refuses a proxy that is not an http:// address", () => {
    expect(() =>
      egressProxy("https:", { NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "socks5://p:1" }),
    ).toThrow(/only an http/);
  });
});

describe("capture through an egress proxy", () => {
  const servers: Server[] = [];
  const seen: { method?: string; url?: string; host?: string }[] = [];
  const saved = { ...process.env };
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
    seen.length = 0;
    process.env = { ...saved };
  });

  async function fakeProxy(): Promise<number> {
    const server = createServer((req: IncomingMessage, res) => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("via proxy");
    });
    server.on("connect", (req, socket) => {
      seen.push({ method: "CONNECT", url: req.url });
      socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return (server.address() as AddressInfo).port;
  }

  const through = (port: number) => {
    process.env.NODE_USE_ENV_PROXY = "1";
    process.env.HTTP_PROXY = `http://127.0.0.1:${port}`;
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
  };

  it("sends a download through the proxy as an absolute-form request", async () => {
    through(await fakeProxy());
    const response = await publicRequest("http://93.184.216.34/font.woff2");
    expect(await response.text()).toBe("via proxy");
    expect(seen).toEqual([
      { method: "GET", url: "http://93.184.216.34/font.woff2", host: "93.184.216.34" },
    ]);
  });

  it("tunnels an https download through the proxy, and reports a refused tunnel", async () => {
    through(await fakeProxy());
    await expect(publicRequest("https://93.184.216.34/app.js")).rejects.toThrow(
      /refused the tunnel \(502\)/,
    );
    expect(seen).toEqual([{ method: "CONNECT", url: "93.184.216.34:443" }]);
  });

  it("still refuses a private address first, without touching the proxy", async () => {
    through(await fakeProxy());
    await expect(publicRequest("http://10.0.0.5/x")).rejects.toThrow(/public IPv4/);
    await expect(publicRequest("https://127.0.0.1/x")).rejects.toThrow(/public IPv4/);
    expect(seen).toEqual([]);
  });

  it("chains the browser proxy through the egress proxy, and refuses a private target before it", async () => {
    through(await fakeProxy());
    const proxy = await startCaptureProxy();
    const port = Number(new URL(proxy.url).port);
    const ok = await fetchViaProxy(port, "http://93.184.216.34/page");
    expect(ok.status).toBe(200);
    const refused = await fetchViaProxy(port, "http://169.254.169.254/latest/meta-data");
    expect(refused.status).toBe(403);
    expect(seen).toEqual([
      { method: "GET", url: "http://93.184.216.34/page", host: "93.184.216.34" },
    ]);
    await proxy.close();
  });

  it("serves a --file page itself and refuses everything else local", async () => {
    const proxy = await startCaptureProxy({ url: LOCAL_DOCUMENT_URL, html: "<h1>local</h1>" });
    const port = Number(new URL(proxy.url).port);
    const page = await fetchViaProxy(port, LOCAL_DOCUMENT_URL);
    expect(page.status).toBe(200);
    expect(page.body).toBe("<h1>local</h1>");
    expect((await fetchViaProxy(port, `${LOCAL_DOCUMENT_URL}style.css`)).status).toBe(403);
    expect((await fetchViaProxy(port, "http://127.0.0.1:1/secret")).status).toBe(403);
    await proxy.close();
  });
});

async function fetchViaProxy(port: number, url: string): Promise<{ status: number; body: string }> {
  const { request } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        method: "GET",
        path: url,
        headers: { host: new URL(url).host },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
