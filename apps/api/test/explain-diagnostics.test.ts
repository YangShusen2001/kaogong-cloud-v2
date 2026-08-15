import { afterEach, describe, expect, it, vi } from "vitest";
import { json, makeApp } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explain diagnostics", () => {
  it("emits one sanitized structured event when the AI provider fails", async () => {
    const providerError = new TypeError("secret provider body with selected text");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(providerError)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = makeApp({ deepseekKey: "secret-key" });

    const response = await app.request(
      "/api/explain",
      json("POST", { text: "private selected text" }, "diagnostics-device"),
    );

    expect(response.status).toBe(502);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({
      event: "ai.explain.failed",
      errorType: "TypeError",
    });
  });
});
