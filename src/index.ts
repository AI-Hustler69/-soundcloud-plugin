/**
 * stdio entry point. Logs go to stderr only (stdout carries the MCP protocol).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, SERVER_NAME, SERVER_VERSION } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  for (const warning of config.warnings) console.error(`[${SERVER_NAME}] ${warning}`);
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} starting in ${config.mode} mode`);

  const server = createServer(config);
  await server.connect(new StdioServerTransport());

  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[${SERVER_NAME}] fatal:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
