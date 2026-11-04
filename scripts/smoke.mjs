// Manual smoke test against the REAL SoundCloud service (not part of `npm test`).
// Usage: node scripts/smoke.mjs <tool> '<json-args>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [tool, rawArgs = "{}"] = process.argv.slice(2);
if (!tool) {
  console.error("usage: node scripts/smoke.mjs <tool> '<json-args>'");
  process.exit(2);
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
const res = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) });
console.log(res.isError ? "ERROR:" : "OK:", res.content?.[0]?.text);
await client.close();
