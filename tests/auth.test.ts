import { describe, expect, it } from "vitest";
import { ClientCredentialsAuth, parseRetryAfter } from "../src/soundcloud/auth.js";
import { AuthError, RateLimitError } from "../src/soundcloud/errors.js";
import { json, MockFetch, TOKEN_URL, tokenResponse } from "./helpers.js";

function setup(now = { t: 1_000_000 }) {
  const mock = new MockFetch();
  const auth = new ClientCredentialsAuth({
    clientId: "my-id",
    clientSecret: "my-secret",
    fetch: mock.fetch,
    now: () => now.t,
  });
  return { mock, auth, now };
}

describe("ClientCredentialsAuth", () => {
  it("requests a token with Basic auth and form-encoded client_credentials grant", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, tokenResponse("abc"));

    await expect(auth.getToken()).resolves.toBe("abc");

    const call = mock.calls[0]!;
    expect(call.url).toBe("https://secure.soundcloud.com/oauth/token");
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from("my-id:my-secret").toString("base64")}`);
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(call.body).toBe("grant_type=client_credentials");
    // Secrets never travel in the URL or the body.
    expect(call.url).not.toContain("my-secret");
    expect(call.body).not.toContain("my-secret");
  });

  it("caches the token until shortly before expiry", async () => {
    const { mock, auth, now } = setup();
    mock.on("POST", TOKEN_URL, tokenResponse("first"), 1);
    mock.on("POST", TOKEN_URL, tokenResponse("second"));

    expect(await auth.getToken()).toBe("first");
    now.t += 30 * 60 * 1000;
    expect(await auth.getToken()).toBe("first");
    expect(mock.calls).toHaveLength(1);

    now.t += 29 * 60 * 1000 + 30_000; // inside the 60 s renewal window
    expect(await auth.getToken()).toBe("second");
  });

  it("renews with the refresh token instead of a new client_credentials grant", async () => {
    const { mock, auth, now } = setup();
    mock.on("POST", TOKEN_URL, tokenResponse("first"), 1);
    mock.on("POST", TOKEN_URL, tokenResponse("second"));

    await auth.getToken();
    now.t += 2 * 3600 * 1000;
    await auth.getToken();
    expect(mock.calls[1]!.body).toBe("grant_type=refresh_token&refresh_token=refresh-first");
  });

  it("falls back to client_credentials when the refresh token is rejected", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, tokenResponse("first"), 1);
    mock.on("POST", TOKEN_URL, json({ error: "invalid_grant" }, 400), 1);
    mock.on("POST", TOKEN_URL, tokenResponse("fresh"));

    await auth.getToken();
    auth.invalidate();
    expect(await auth.getToken()).toBe("fresh");
    expect(mock.calls.map((c) => c.body?.split("&")[0])).toEqual([
      "grant_type=client_credentials",
      "grant_type=refresh_token",
      "grant_type=client_credentials",
    ]);
  });

  it("collapses concurrent callers onto a single token request", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, tokenResponse("shared"));
    const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(tokens).toEqual(["shared", "shared", "shared"]);
    expect(mock.calls).toHaveLength(1);
  });

  it("throws a helpful AuthError on invalid credentials without leaking the secret", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, json({ error: "invalid_client" }, 401));
    const err = await auth.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as Error).message).toContain("invalid_client");
    expect((err as Error).message).toContain("SOUNDCLOUD_CLIENT_ID");
    expect((err as Error).message).not.toContain("my-secret");
  });

  it("throws RateLimitError when token issuance is rate-limited", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, json({}, 429, { "retry-after": "120" }));
    const err = await auth.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBe(120);
  });

  it("rejects a response without access_token", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, json({ token_type: "bearer" }));
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthError);
  });

  it("does not cache failures", async () => {
    const { mock, auth } = setup();
    mock.on("POST", TOKEN_URL, json({}, 500), 1);
    mock.on("POST", TOKEN_URL, tokenResponse("ok"));
    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthError);
    await expect(auth.getToken()).resolves.toBe("ok");
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("garbage")).toBeUndefined();
    const now = Date.parse("2026-11-04T10:00:00Z");
    expect(parseRetryAfter("Wed, 04 Nov 2026 10:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Wed, 04 Nov 2026 09:00:00 GMT", now)).toBe(0);
  });
});
