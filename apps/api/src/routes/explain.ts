import { Hono } from "hono";
import { explainRequestSchema } from "@kaogong/contracts";
import type { AppConfig } from "../app";
import { explainText } from "../lib/deepseek";
import { getDeviceId } from "../lib/device";
import { badInput, fail } from "../lib/http";

export function explainRoutes(config: AppConfig) {
  const r = new Hono();

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const key = config.deepseekKey;
    if (!key) return fail(c, 503, "AI_UNAVAILABLE", "未配置 DeepSeek API Key");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = explainRequestSchema.safeParse(body);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    try {
      const explanation = await explainText(parsed.data.text, key);
      return c.json({ ok: true, data: { explanation } });
    } catch {
      return fail(c, 502, "AI_ERROR", "AI 解释失败");
    }
  });

  return r;
}
