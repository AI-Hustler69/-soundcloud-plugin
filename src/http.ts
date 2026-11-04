/**
 * HTTP transport selection. Node's built-in fetch ignores HTTPS_PROXY /
 * HTTP_PROXY, so behind a proxy (corporate networks, sandboxes) every request
 * would fail. When a proxy variable is set we route requests through undici's
 * EnvHttpProxyAgent, which also honours NO_PROXY.
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { FetchLike } from "./soundcloud/types.js";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

export function proxyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return PROXY_VARS.some((name) => (env[name] ?? "").trim() !== "");
}

/**
 * Returns a proxy-aware fetch when a proxy is configured, otherwise undefined
 * (callers then use the global fetch).
 */
export function createProxyFetch(env: NodeJS.ProcessEnv = process.env): FetchLike | undefined {
  if (!proxyConfigured(env)) return undefined;
  const pick = (...names: string[]) => names.map((n) => env[n]).find((v) => v && v.trim() !== "");
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: pick("HTTP_PROXY", "http_proxy"),
    httpsProxy: pick("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"),
    noProxy: pick("NO_PROXY", "no_proxy"),
  });
  const proxied = (input: string | URL, init?: RequestInit) =>
    undiciFetch(input, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);
  return proxied as unknown as FetchLike;
}
