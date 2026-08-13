import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { favoriteCreateSchema, type Favorite } from "@kaogong/contracts";
import type { DB } from "../app";
import { favorites } from "../db/schema";
import { getDeviceId } from "../lib/device";
import { badInput, fail } from "../lib/http";

export function favoritesRoutes(db: DB) {
  const r = new Hono();

  r.get("/", (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    const rows = db.select().from(favorites)
      .where(eq(favorites.deviceId, dev))
      .orderBy(desc(favorites.createdAt)).all();
    const data: Favorite[] = rows.map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      source: row.source,
      note: row.note,
      createdAt: row.createdAt,
    }));
    return c.json({ ok: true, data });
  });

  r.post("/", async (c) => {
    const dev = getDeviceId(c);
    if (!dev) return fail(c, 400, "DEVICE_REQUIRED", "缺少设备标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = favoriteCreateSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { url, title, source, note } = parsed.data;
    const row = {
      id: crypto.randomUUID(),
      deviceId: dev,
      url,
      title,
      source: source ?? "",
      note: note ?? "",
      createdAt: Date.now(),
    };
    db.insert(favorites).values(row).run();
    const data: Favorite = { id: row.id, url, title, source: source ?? "", note: note ?? "", createdAt: row.createdAt };
    return c.json({ ok: true, data }, 201);
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
