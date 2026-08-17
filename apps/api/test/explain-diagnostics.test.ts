import { afterEach, describe, expect, it, vi } from "vitest";
import { json, makeApp, readJson } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explain diagnostics", () => {
  it("emits one sanitized structured event when the AI provider fails", async () => {
    const providerError = new TypeError("secret provider body with selected text");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(providerError)));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = makeApp({ deepseekKey: "secret-key", jobSecret: "job-secret" });

    // 先激活邀请码，使匿名请求能通过权限门禁、真正调用到 AI provider
    const gen = await app.request("/api/invite/admin/invite-codes", { method: "POST", headers: { "x-job-secret": "job-secret" } });
    const code = (await readJson<{ code: string }>(gen)).data.code;
    await app.request("/api/invite/activate", json("POST", { code }, "diagnostics-device"));

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
