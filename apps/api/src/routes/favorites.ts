import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { DB } from "../app";
import { favorites } from "../db/schema";
import { getDeviceId } from "../lib/device";
import { badInput, fail } from "../lib/http";

function toFavorite(row: typeof favorites.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    source: row.source,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function favoritesRoutes(db: DB) {
  const r = new Hono();

  r.get("/", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const rows = db.select().from(favorites)
      .where(eq(favorites.deviceId, dev))
      .orderBy(desc(favorites.createdAt)).all();
    return c.json({ ok: true, data: rows.map(toFavorite) });
  });

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!url || !title) return badInput(c, "url 和 title 必填");
    const row = {
      id: crypto.randomUUID(),
      deviceId: dev,
      url,
      title,
      source: typeof body.source === "string" ? body.source : "",
      note: typeof body.note === "string" ? body.note : "",
      createdAt: Date.now(),
    };
    db.insert(favorites).values(row).run();
    return c.json({ ok: true, data: toFavorite(row) }, 201);
  });

  r.delete("/:id", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const id = c.req.param("id");
    db.delete(favorites).where(and(eq(favorites.id, id), eq(favorites.deviceId, dev))).run();
    return c.json({ ok: true, data: null });
  });

  return r;
}
