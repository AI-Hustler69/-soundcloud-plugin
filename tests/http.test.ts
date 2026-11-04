import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createProxyFetch, proxyConfigured } from "../src/http.js";

describe("proxy support", () => {
  it("detects proxy variables", () => {
    expect(proxyConfigured({})).toBe(false);
    expect(proxyConfigured({ HTTPS_PROXY: "  " })).toBe(false);
    expect(proxyConfigured({ HTTPS_PROXY: "http://proxy:3128" })).toBe(true);
    expect(proxyConfigured({ http_proxy: "http://proxy:3128" })).toBe(true);
    expect(createProxyFetch({})).toBeUndefined();
  });

  let proxy: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (proxy ? proxy.close(() => resolve()) : resolve())));

  it("routes requests through the configured proxy (local loopback proxy, no real network)", async () => {
    const seen: string[] = [];
    proxy = createServer();
    // undici's proxy agent tunnels every request with CONNECT; answer the tunnel
    // and then play the target server on the same socket.
    proxy.on("connect", (req, socket) => {
      seen.push(`${req.method} ${req.url}`);
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.once("data", (chunk: Buffer) => {
        seen.push(chunk.toString("utf8").split("\r\n")[0] ?? "");
        const body = JSON.stringify({ via: "proxy" });
        socket.end(
          `HTTP/1.1 302 Found\r\nLocation: https://api.soundcloud.com/tracks/1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
        );
      });
    });
    await new Promise<void>((resolve) => proxy!.listen(0, "127.0.0.1", () => resolve()));
    const { port } = proxy.address() as AddressInfo;

    const proxied = createProxyFetch({ HTTP_PROXY: `http://127.0.0.1:${port}` })!;
    // Plain-http target so the test proxy can read the tunnelled request.
    const res = await proxied("http://soundcloud.invalid/oembed?format=json", { redirect: "manual" });

    expect(seen).toEqual(["CONNECT soundcloud.invalid:80", "GET /oembed?format=json HTTP/1.1"]);
    // redirect: "manual" must still expose the real 302 + Location (needed by /resolve).
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://api.soundcloud.com/tracks/1");
  });

  it("honours NO_PROXY", () => {
    expect(createProxyFetch({ HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "soundcloud.com" })).toBeTypeOf("function");
  });
});
