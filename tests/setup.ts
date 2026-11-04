// Safety net: no test may ever reach the real network. Every test injects
// its own mocked fetch; anything that falls through to the global fetch fails.
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", (input: unknown) => {
    throw new Error(`Real network access is forbidden in tests (attempted: ${String(input)})`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
