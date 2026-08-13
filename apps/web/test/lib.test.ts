import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../src/lib/api";
import { DEVICE_KEY, getOrCreateDeviceId } from "../src/lib/device";

afterEach(() => vi.unstubAllGlobals());

describe("device", () => {
  it("复用已存在的设备 id", () => {
    const store = { get: vi.fn(() => "existing"), set: vi.fn() };
    expect(getOrCreateDeviceId(store, () => "never")).toBe("existing");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("生成并存储新设备 id", () => {
    const store = { get: vi.fn(() => null), set: vi.fn() };
    expect(getOrCreateDeviceId(store, () => "gen-1")).toBe("gen-1");
    expect(store.set).toHaveBeenCalledWith(DEVICE_KEY, "gen-1");
  });
});

describe("api client", () => {
  it("自动带 X-Device-Id 头并解析响应", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({ ok: true, data: [{ id: "1", url: "u", title: "t", source: "", note: "", createdAt: 1 }] }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("https://api.example", () => "dev-123");
    const env = await api.listFavorites();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/api/favorites");
    expect(new Headers(init.headers).get("x-device-id")).toBe("dev-123");
    expect(env.data).toHaveLength(1);
  });
});
