import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DB } from "../app";
import { practice } from "../db/schema";
import { getDeviceId } from "../lib/device";
import { badInput, fail } from "../lib/http";

export function practiceRoutes(db: DB) {
  const r = new Hono();

  r.get("/", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const rows = db.select().from(practice).where(eq(practice.deviceId, dev)).all();
    return c.json({ ok: true, data: rows.map(({ date, correct, total }) => ({ date, correct, total })) });
  });

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const date = typeof body.date === "string" ? body.date : "";
    const correct = typeof body.correct === "number" ? body.correct : NaN;
    const total = typeof body.total === "number" ? body.total : NaN;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(correct) || !Number.isFinite(total)) {
      return badInput(c, "date/correct/total 非法");
    }
    const c2 = Math.round(correct);
    const t2 = Math.round(total);
    // 同一 device+date 重复提交即覆盖（复合主键 + onConflictDoUpdate）
    db.insert(practice)
      .values({ deviceId: dev, date, correct: c2, total: t2 })
      .onConflictDoUpdate({ target: [practice.deviceId, practice.date], set: { correct: c2, total: t2 } })
      .run();
    return c.json({ ok: true, data: { date, correct: c2, total: t2 } });
  });

  return r;
}
