// Bundles the server into a single self-contained file (dist/server.js) so the
// Claude Code plugin runs straight from a git checkout without `npm install`,
// and writes the licenses of every bundled third-party package next to it.
import { build } from "esbuild";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outfile = "dist/server.js";
const licensesFile = "dist/THIRD_PARTY_LICENSES.txt";

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  metafile: true,
  legalComments: "eof",
  logLevel: "info",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "// soundcloud-dj-mcp: bundled build, see https://github.com/AI-Hustler69/-soundcloud-plugin for sources.",
      "// Third-party licenses: THIRD_PARTY_LICENSES.txt next to this file.",
      "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    ].join("\n"),
  },
});

await chmod(outfile, 0o755);

// Collect the package root of every bundled input under node_modules.
const roots = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const parts = input.split("/");
  const idx = parts.lastIndexOf("node_modules");
  if (idx === -1) continue;
  const scoped = parts[idx + 1]?.startsWith("@");
  roots.add(parts.slice(0, idx + (scoped ? 3 : 2)).join("/"));
}

const sections = [];
for (const root of [...roots].sort()) {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const files = await readdir(root);
  const licenseName = files.find((f) => /^(licen[cs]e|copying)(\..*)?$/i.test(f));
  const text = licenseName
    ? (await readFile(path.join(root, licenseName), "utf8")).trim()
    : `License: ${pkg.license ?? "UNKNOWN"} (no license file shipped in the package)`;
  sections.push(`${pkg.name}@${pkg.version} (${pkg.license ?? "UNKNOWN"})\n${"-".repeat(72)}\n${text}`);
}

await writeFile(
  licensesFile,
  `Third-party software bundled in dist/server.js\n${"=".repeat(72)}\n\n${sections.join(`\n\n${"=".repeat(72)}\n\n`)}\n`,
);
console.log(`  ${licensesFile}  ${sections.length} packages`);
