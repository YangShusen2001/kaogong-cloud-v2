import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  highlightCreateSchema,
  highlightStyleSchema,
  type Highlight,
  type HighlightStyle,
} from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { highlights } from "../db/schema";
import { resolveOwnerId } from "../lib/identity";
import { badInput, fail } from "../lib/http";

/** 把 DB 行映射为契约里的 Highlight（styles 从 JSON 字符串还原）。 */
function rowToHighlight(row: typeof highlights.$inferSelect): Highlight {
  let styles: HighlightStyle[] = [];
  try {
    const parsed = highlightStyleSchema.array().safeParse(JSON.parse(row.styles));
    if (parsed.success) styles = parsed.data;
  } catch {
    styles = [];
  }
  return {
    id: row.id,
    articleId: row.articleId,
    text: row.text,
    note: row.note,
    styles,
    paragraphIndex: row.paragraphIndex,
    start: row.startOffset,
    end: row.endOffset,
    createdAt: row.createdAt,
  };
}

export function highlightsRoutes(db: DB, config: AppConfig) {
  const r = new Hono();

  r.get("/", async (c) => {
    const owner = await resolveOwnerId(c, config.authSecret ?? "");
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const rows = db.select().from(highlights)
      .where(eq(highlights.ownerId, owner))
      .orderBy(desc(highlights.createdAt)).all();
    return c.json({ ok: true, data: rows.map(rowToHighlight) });
  });

  r.post("/", async (c) => {
    const owner = await resolveOwnerId(c, config.authSecret ?? "");
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = highlightCreateSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { articleId, text, note, styles, paragraphIndex, start, end } = parsed.data;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    db.insert(highlights).values({
      id,
      ownerId: owner,
      articleId,
      text,
      note: note ?? "",
      styles: JSON.stringify(styles),
      paragraphIndex,
      startOffset: start,
      endOffset: end,
      createdAt,
    }).run();
    const data: Highlight = { id, articleId, text, note: note ?? "", styles, paragraphIndex, start, end, createdAt };
    return c.json({ ok: true, data }, 201);
  });

  r.delete("/:id", async (c) => {
    const owner = await resolveOwnerId(c, config.authSecret ?? "");
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const id = c.req.param("id");
    db.delete(highlights).where(and(eq(highlights.id, id), eq(highlights.ownerId, owner))).run();
    return c.json({ ok: true, data: null });
  });

  return r;
}
