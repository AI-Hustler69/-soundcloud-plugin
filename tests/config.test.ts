import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses API mode when both credentials are set", () => {
    const c = loadConfig({ SOUNDCLOUD_CLIENT_ID: " id ", SOUNDCLOUD_CLIENT_SECRET: "secret" });
    expect(c).toMatchObject({ mode: "api", clientId: "id", clientSecret: "secret", warnings: [] });
  });

  it("falls back to oEmbed mode when credentials are missing, empty or unexpanded", () => {
    expect(loadConfig({}).mode).toBe("oembed");
    expect(loadConfig({ SOUNDCLOUD_CLIENT_ID: "", SOUNDCLOUD_CLIENT_SECRET: "" }).mode).toBe("oembed");
    expect(
      loadConfig({ SOUNDCLOUD_CLIENT_ID: "${SOUNDCLOUD_CLIENT_ID}", SOUNDCLOUD_CLIENT_SECRET: "${SOUNDCLOUD_CLIENT_SECRET}" }).mode,
    ).toBe("oembed");
  });

  it("warns when only one credential is set, without echoing it", () => {
    const c = loadConfig({ SOUNDCLOUD_CLIENT_ID: "only-id" });
    expect(c.mode).toBe("oembed");
    expect(c.warnings.join(" ")).toMatch(/Only one of/);
    expect(c.warnings.join(" ")).not.toContain("only-id");
  });
});
