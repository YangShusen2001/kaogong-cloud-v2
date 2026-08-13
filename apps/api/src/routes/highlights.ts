import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DB } from "../app";
import { highlights } from "../db/schema";
import { getDeviceId } from "../lib/device";
import { badInput, fail } from "../lib/http";

function toHighlight(row: typeof highlights.$inferSelect) {
  return {
    id: row.id,
    articleId: row.articleId,
    text: row.text,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function highlightsRoutes(db: DB) {
  const r = new Hono();

  r.get("/", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const rows = db.select().from(highlights)
      .where(eq(highlights.deviceId, dev))
      .orderBy(desc(highlights.createdAt)).all();
    return c.json({ ok: true, data: rows.map(toHighlight) });
  });

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const articleId = typeof body.articleId === "string" ? body.articleId.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!articleId || !text) return badInput(c, "articleId 和 text 必填");
    const row = {
      id: crypto.randomUUID(),
      deviceId: dev,
      articleId,
      text,
      note: typeof body.note === "string" ? body.note : "",
      createdAt: Date.now(),
    };
    db.insert(highlights).values(row).run();
    return c.json({ ok: true, data: toHighlight(row) }, 201);
  });

  r.delete("/:id", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const id = c.req.param("id");
    db.delete(highlights).where(and(eq(highlights.id, id), eq(highlights.deviceId, dev))).run();
    return c.json({ ok: true, data: null });
  });

  return r;
}
