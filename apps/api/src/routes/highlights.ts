import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { highlightCreateSchema, type Highlight } from "@kaogong/contracts";
import type { DB } from "../app";
import { highlights } from "../db/schema";
import { getDeviceId } from "../lib/device";
import { badInput, fail } from "../lib/http";

export function highlightsRoutes(db: DB) {
  const r = new Hono();

  r.get("/", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const rows = db.select().from(highlights)
      .where(eq(highlights.deviceId, dev))
      .orderBy(desc(highlights.createdAt)).all();
    const data: Highlight[] = rows.map((row) => ({
      id: row.id,
      articleId: row.articleId,
      text: row.text,
      note: row.note,
      style: row.style as Highlight["style"],
      createdAt: row.createdAt,
    }));
    return c.json({ ok: true, data });
  });

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = highlightCreateSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { articleId, text, note, style } = parsed.data;
    const row = {
      id: crypto.randomUUID(),
      deviceId: dev,
      articleId,
      text,
      note: note ?? "",
      style: style ?? "yellow",
      createdAt: Date.now(),
    };
    db.insert(highlights).values(row).run();
    const data: Highlight = {
      id: row.id,
      articleId,
      text,
      note: note ?? "",
      style: row.style as Highlight["style"],
      createdAt: row.createdAt,
    };
    return c.json({ ok: true, data }, 201);
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
