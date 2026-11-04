// Bundles the server into a single self-contained file (dist/server.js) so the
// Claude Code plugin runs straight from a git checkout without `npm install`.
import { build } from "esbuild";
import { chmod } from "node:fs/promises";

const outfile = "dist/server.js";

await build({
  entryPoints: ["src/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  legalComments: "eof",
  logLevel: "info",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "// soundcloud-dj-mcp: bundled build, see https://github.com/AI-Hustler69/-soundcloud-plugin for sources.",
      "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    ].join("\n"),
  },
});

await chmod(outfile, 0o755);
