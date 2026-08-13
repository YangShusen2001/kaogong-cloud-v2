// 类型化 API 客户端：自动带 X-Device-Id 头，响应类型来自 @kaogong/contracts。
import type { ApiError, ExplainResponse, Favorite, FavoriteCreate, Highlight, PracticeRecord } from "@kaogong/contracts";
import { getDeviceId } from "./device";

export interface Envelope<T> {
  ok: boolean;
  data: T | null;
  error?: ApiError;
}

/** 后端地址：本地 wrangler dev 默认 8787；部署时用 PUBLIC_API_BASE 环境变量覆盖 */
export const API_BASE =
  (import.meta.env.PUBLIC_API_BASE as string | undefined) ?? "http://127.0.0.1:8787";

export function createApi(base: string, deviceId: () => string) {
  async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
    const headers = new Headers(init?.headers);
    headers.set("x-device-id", deviceId());
    if (init?.body) headers.set("content-type", "application/json");
    try {
      const res = await fetch(base + path, { ...init, headers });
      return (await res.json()) as Envelope<T>;
    } catch {
      return { ok: false, data: null, error: { code: "NETWORK", message: "网络错误" } };
    }
  }

  return {
    listFavorites: () => request<Favorite[]>("/api/favorites"),
    addFavorite: (body: FavoriteCreate) =>
      request<Favorite>("/api/favorites", { method: "POST", body: JSON.stringify(body) }),
    removeFavorite: (id: string) => request<null>(`/api/favorites/${id}`, { method: "DELETE" }),
    listHighlights: () => request<Highlight[]>("/api/highlights"),
    addHighlight: (body: { articleId: string; text: string; note?: string }) =>
      request<Highlight>("/api/highlights", { method: "POST", body: JSON.stringify(body) }),
    submitPractice: (body: PracticeRecord) =>
      request<PracticeRecord>("/api/practice", { method: "POST", body: JSON.stringify(body) }),
    explain: (text: string) =>
      request<ExplainResponse>("/api/explain", { method: "POST", body: JSON.stringify({ text }) }),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi(API_BASE, getDeviceId);
