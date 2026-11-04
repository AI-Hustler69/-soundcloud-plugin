import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../src/config.js";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

describe("version", () => {
  // Claude Code only delivers plugin updates when plugin.json's version changes,
  // so all version strings must be bumped together on every release.
  it("is the same in package.json, plugin.json, the lockfile and the server", () => {
    const pkg = readJson("package.json").version;
    expect(readJson(".claude-plugin/plugin.json").version).toBe(pkg);
    expect(readJson("package-lock.json").version).toBe(pkg);
    expect(SERVER_VERSION).toBe(pkg);
  });
});
