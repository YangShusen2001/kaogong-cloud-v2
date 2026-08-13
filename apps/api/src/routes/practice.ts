import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { practiceSubmitSchema, type PracticeRecord } from "@kaogong/contracts";
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
    const data: PracticeRecord[] = rows.map(({ date, correct, total }) => ({ date, correct, total }));
    return c.json({ ok: true, data });
  });

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = practiceSubmitSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { date, correct, total } = parsed.data;
    // 同一 device+date 重复提交即覆盖（复合主键 + onConflictDoUpdate）
    db.insert(practice)
      .values({ deviceId: dev, date, correct, total })
      .onConflictDoUpdate({ target: [practice.deviceId, practice.date], set: { correct, total } })
      .run();
    const data: PracticeRecord = { date, correct, total };
    return c.json({ ok: true, data });
  });

  return r;
}
