// 统一响应工具：ApiEnvelope 契约里的 { ok:false, error } 失败态
import type { Context } from "hono";

export function fail(c: Context, status: 400 | 401 | 402 | 403 | 404 | 409 | 410 | 429 | 500 | 502 | 503, code: string, message: string) {
  return c.json({ ok: false, error: { code, message } }, status);
}

export function badInput(c: Context, message: string) {
  return fail(c, 400, "INVALID_INPUT", message);
}
