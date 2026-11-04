import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer, TOOL_NAMES } from "../src/server.js";
import { API, json, MockFetch, noSleep, TOKEN_URL, tokenResponse, track } from "./helpers.js";

async function connect(env: Record<string, string>, mock: MockFetch) {
  const server = createServer(loadConfig(env), { fetch: mock.fetch, sleep: noSleep });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

describe("MCP server", () => {
  it("lists the four read-only tools", async () => {
    const client = await connect({}, new MockFetch());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    const search = tools.find((t) => t.name === "search_tracks")!;
    expect(Object.keys(search.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["query", "genre", "bpm_min", "bpm_max", "downloadable_only", "limit"]),
    );
    expect((search.inputSchema.properties as Record<string, { default?: unknown }>).downloadable_only?.default).toBe(true);
  });

  it("runs search_tracks end to end with mocked API", async () => {
    const mock = new MockFetch();
    mock.on("POST", TOKEN_URL, tokenResponse());
    mock.on("GET", `${API}/tracks?`, json({ collection: [track({ id: 1, downloadable: true, bpm: 128, key_signature: "Am" })] }));
    const client = await connect({ SOUNDCLOUD_CLIENT_ID: "id", SOUNDCLOUD_CLIENT_SECRET: "secret" }, mock);

    const res = await client.callTool({ name: "search_tracks", arguments: { query: "techno", bpm_min: 125, bpm_max: 130 } });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(text(res));
    expect(data.results[0]).toMatchObject({ id: "1", bpm: 128, camelot: "8A", downloadable: true });
    expect(res.structuredContent).toMatchObject({ mode: "api" });
  });

  it("returns tool errors (not protocol errors) for bad input and limited mode", async () => {
    const client = await connect({}, new MockFetch());
    const res = await client.callTool({ name: "search_tracks", arguments: { query: "x" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/Artist Pro/);

    const bad = await client.callTool({ name: "resolve_url", arguments: { url: "https://example.com" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/Not a soundcloud.com URL/);
  });

  it("rejects schema violations before the handler runs", async () => {
    // API mode with a mock that has no routes: any handler call would fail with "Unexpected request".
    const mock = new MockFetch();
    const client = await connect({ SOUNDCLOUD_CLIENT_ID: "id", SOUNDCLOUD_CLIENT_SECRET: "secret" }, mock);
    const res = await client.callTool({ name: "search_tracks", arguments: { query: "x", limit: 999 } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/validation/i);
    expect(text(res)).toMatch(/limit/);
    expect(mock.calls).toHaveLength(0);
  });

  it("surfaces API auth errors as tool errors without leaking the secret", async () => {
    const mock = new MockFetch();
    mock.on("POST", TOKEN_URL, json({ error: "invalid_client" }, 401));
    const client = await connect({ SOUNDCLOUD_CLIENT_ID: "id", SOUNDCLOUD_CLIENT_SECRET: "super-secret" }, mock);
    const res = await client.callTool({ name: "get_track", arguments: { track: "1" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/invalid_client/);
    expect(text(res)).not.toContain("super-secret");
  });
});
