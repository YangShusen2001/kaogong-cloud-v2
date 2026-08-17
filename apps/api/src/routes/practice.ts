import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { practiceSubmitSchema, type PracticeRecord, type WrongQuestion } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { practice, wrongQuestions } from "../db/schema";
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
    const { date, correct, total, wrong } = parsed.data;
    // 同一归属同一天只留一条（复合主键 + onConflictDoUpdate）
    await db.insert(practice)
      .values({ ownerId: owner, date, correct, total })
      .onConflictDoUpdate({ target: [practice.ownerId, practice.date], set: { correct, total } })
      .run();
    // 错题覆盖式：同一天重做，先删旧错题再写新错题
    await db.delete(wrongQuestions)
      .where(and(eq(wrongQuestions.ownerId, owner), eq(wrongQuestions.date, date)))
      .run();
    for (const w of wrong) {
      await db.insert(wrongQuestions).values({
        id: crypto.randomUUID(),
        ownerId: owner,
        date,
        question: w.question,
        options: JSON.stringify(w.options),
        answer: w.answer,
        chosen: w.chosen,
        analysis: w.analysis,
        createdAt: Date.now(),
      }).run();
    }
    const data: PracticeRecord = { date, correct, total };
    return c.json({ ok: true, data });
  });

  // —— 错题本 ——
  r.get("/wrong", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const rows = await db.select().from(wrongQuestions).where(eq(wrongQuestions.ownerId, owner)).all();
    const data: WrongQuestion[] = rows.map((row) => ({
      id: row.id,
      date: row.date,
      question: row.question,
      options: JSON.parse(row.options),
      answer: row.answer,
      chosen: row.chosen,
      analysis: row.analysis,
    }));
    return c.json({ ok: true, data });
  });

  r.delete("/wrong/:id", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const id = c.req.param("id");
    await db.delete(wrongQuestions)
      .where(and(eq(wrongQuestions.ownerId, owner), eq(wrongQuestions.id, id)))
      .run();
    return c.json({ ok: true, data: null });
  });

  return r;
}
