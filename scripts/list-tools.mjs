// Starts the bundled server over stdio, performs the MCP handshake and prints
// the advertised tools. Makes no SoundCloud API calls.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "list-tools", version: "0.0.0" });
await client.connect(transport);

const info = client.getServerVersion();
const { tools } = await client.listTools();
console.log(`${info?.name} ${info?.version}: ${tools.length} tools`);
for (const tool of tools) {
  const params = Object.keys(tool.inputSchema?.properties ?? {}).join(", ");
  console.log(`- ${tool.name}(${params})`);
}
await client.close();
