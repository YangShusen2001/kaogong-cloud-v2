import { Hono } from "hono";
import { explainRequestSchema } from "@kaogong/contracts";
import type { AppConfig } from "../app";
import { explainText } from "../lib/deepseek";
import { getDeviceId } from "../lib/device";
import { diagnosticError, errorType } from "../lib/diagnostics";
import { badInput, fail } from "../lib/http";

/** 轻量级每设备限流：最多 10 次/分钟。生产可替换为 Cloudflare ratelimit binding。 */
interface RateBucket {
  count: number;
  resetAt: number;
}

const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

const buckets = new Map<string, RateBucket>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (b.count >= RATE_LIMIT) return false;
  b.count += 1;
  return true;
}

export function explainRoutes(config: AppConfig) {
  const r = new Hono();

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    if (!checkRateLimit(`explain:${dev}`)) {
      c.header("Retry-After", String(RATE_WINDOW / 1000));
      return fail(c, 429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
    }
    const key = config.deepseekKey;
    if (!key) return fail(c, 503, "AI_UNAVAILABLE", "未配置 DeepSeek API Key");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = explainRequestSchema.safeParse(body);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    try {
      const explanation = await explainText(parsed.data.text, key);
      return c.json({ ok: true, data: { explanation } });
    } catch (error) {
      diagnosticError({ event: "ai.explain.failed", errorType: errorType(error) });
      return fail(c, 502, "AI_ERROR", "AI 解释失败");
    }
  });

  return r;
}
