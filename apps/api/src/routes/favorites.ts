import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { favoriteCreateSchema, type Favorite, type FavoriteKind } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { favorites } from "../db/schema";
import { resolveOwnerId } from "../lib/identity";
import { badInput, fail } from "../lib/http";

function toFavorite(row: typeof favorites.$inferSelect): Favorite {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    source: row.source,
    note: row.note,
    kind: row.kind as FavoriteKind,
    quote: row.quote,
    createdAt: row.createdAt,
  };
}

export function favoritesRoutes(db: DB, config: AppConfig) {
  const r = new Hono();

  r.get("/", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const rows = await db.select().from(favorites)
      .where(eq(favorites.ownerId, owner))
      .orderBy(desc(favorites.createdAt)).all();
    return c.json({ ok: true, data: rows.map(toFavorite) });
  });

  r.post("/", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = favoriteCreateSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { url, title, source, note, kind, quote } = parsed.data;
    // 金句按 (owner, url, quote) 幂等，文章按 (owner, url) 幂等（article 的 quote 恒为空串）。
    const normalizedQuote = kind === "quote" ? quote : "";
    const existing = await db.select().from(favorites).where(and(
      eq(favorites.ownerId, owner),
      eq(favorites.url, url),
      eq(favorites.kind, kind),
      eq(favorites.quote, normalizedQuote),
    )).get();
    if (existing) {
      return c.json({ ok: true, data: toFavorite(existing) }, 200);
    }
    const row = {
      id: crypto.randomUUID(),
      ownerId: owner,
      url,
      title,
      source: source ?? "",
      note: note ?? "",
      kind,
      quote: normalizedQuote,
      createdAt: Date.now(),
    };
    await db.insert(favorites).values(row).run();
    return c.json({ ok: true, data: toFavorite(row) }, 201);
  });

  r.delete("/:id", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const id = c.req.param("id");
    await db.delete(favorites).where(and(eq(favorites.id, id), eq(favorites.ownerId, owner))).run();
    return c.json({ ok: true, data: null });
  });

  return r;
}
