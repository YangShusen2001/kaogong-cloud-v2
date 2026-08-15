import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { practiceSubmitSchema, type PracticeRecord } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { practice } from "../db/schema";
import { resolveOwnerId } from "../lib/identity";
import { badInput, fail } from "../lib/http";

export function practiceRoutes(db: DB, config: AppConfig) {
  const r = new Hono();

  r.get("/", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const rows = await db.select().from(practice).where(eq(practice.ownerId, owner)).all();
    const data: PracticeRecord[] = rows.map(({ date, correct, total }) => ({ date, correct, total }));
    return c.json({ ok: true, data });
  });

  r.post("/", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = practiceSubmitSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { date, correct, total } = parsed.data;
    // 同一归属同一天只留一条（复合主键 + onConflictDoUpdate）
    await db.insert(practice)
      .values({ ownerId: owner, date, correct, total })
      .onConflictDoUpdate({ target: [practice.ownerId, practice.date], set: { correct, total } })
      .run();
    const data: PracticeRecord = { date, correct, total };
    return c.json({ ok: true, data });
  });

  return r;
}
