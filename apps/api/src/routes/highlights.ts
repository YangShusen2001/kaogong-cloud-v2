import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  highlightParagraphReplaceSchema,
  highlightSpanSchema,
  highlightStyleSchema,
  type Highlight,
  type HighlightParagraphListItem,
  type HighlightStyle,
} from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { highlightParagraphs, highlights } from "../db/schema";
import { resolveOwnerId } from "../lib/identity";
import { badInput, fail } from "../lib/http";

const RETIRED_HIGHLIGHT_API_ERROR = {
  ok: false,
  error: { code: "HIGHLIGHT_API_RETIRED", message: "旧版划线接口已停用，请使用段落划线接口" },
} as const;

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
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const rows = await db.select().from(highlights)
      .where(eq(highlights.ownerId, owner))
      .orderBy(desc(highlights.createdAt)).all();
    return c.json({ ok: true, data: rows.map(rowToHighlight) });
  });

  r.put("/paragraph", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = highlightParagraphReplaceSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { articleId, paragraphIndex, baseVersion, spans } = parsed.data;

    const normalized = spans.map((span) => ({
      ...span,
      styles: [...new Set(span.styles)].sort(),
    }));
    const current = await db.select().from(highlightParagraphs).where(and(
      eq(highlightParagraphs.ownerId, owner),
      eq(highlightParagraphs.articleId, articleId),
      eq(highlightParagraphs.paragraphIndex, paragraphIndex),
    )).get();
    if ((current?.version ?? 0) !== baseVersion) {
      return fail(c, 409, "HIGHLIGHT_CONFLICT", "划线已在其他页面更新，请重新加载");
    }
    const updatedAt = Date.now();
    const rows = await db.insert(highlightParagraphs).values({
      ownerId: owner, articleId, paragraphIndex, version: 1,
      spans: JSON.stringify(normalized), updatedAt,
    }).onConflictDoUpdate({
      target: [highlightParagraphs.ownerId, highlightParagraphs.articleId, highlightParagraphs.paragraphIndex],
      set: {
        version: sql`${highlightParagraphs.version} + 1`,
        spans: JSON.stringify(normalized),
        updatedAt,
      },
      setWhere: eq(highlightParagraphs.version, baseVersion),
    }).returning().all();
    const row = rows[0];
    if (!row || (baseVersion === 0 && row.version !== 1)) {
      return fail(c, 409, "HIGHLIGHT_CONFLICT", "划线已在其他页面更新，请重新加载");
    }
    // 新版本化存储已生效，删除同段落被取代的旧版 highlights 行（仅在成功路径，409 不删）
    await db.delete(highlights).where(and(
      eq(highlights.ownerId, owner),
      eq(highlights.articleId, articleId),
      eq(highlights.paragraphIndex, paragraphIndex),
    )).run();
    const data = normalized.map((span, index) => ({
      id: `${articleId}:${paragraphIndex}:${row.version}:${index}`,
      articleId, paragraphIndex, ...span, createdAt: row.updatedAt,
    }));
    return c.json({ ok: true, data: { version: row.version, highlights: data } });
  });

  r.get("/paragraphs/:articleId", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const articleId = c.req.param("articleId");
    const rows = await db.select().from(highlightParagraphs).where(and(
      eq(highlightParagraphs.ownerId, owner),
      eq(highlightParagraphs.articleId, articleId),
    )).all();
    const data = new Map<number, HighlightParagraphListItem>();
    const versionedUpdatedAt = new Map<number, number>();
    for (const row of rows) {
      let rawSpans: unknown;
      try {
        rawSpans = JSON.parse(row.spans);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return fail(c, 500, "HIGHLIGHT_STATE_INVALID", "划线状态损坏，请稍后重试");
        }
        throw error;
      }
      const parsed = highlightSpanSchema.array().safeParse(rawSpans);
      if (!parsed.success) {
        return fail(c, 500, "HIGHLIGHT_STATE_INVALID", "划线状态损坏，请稍后重试");
      }
      data.set(row.paragraphIndex, {
        paragraphIndex: row.paragraphIndex,
        version: row.version,
        highlights: parsed.data.map((span, index) => ({
          id: `${articleId}:${row.paragraphIndex}:${row.version}:${index}`,
          articleId, paragraphIndex: row.paragraphIndex, ...span, createdAt: row.updatedAt,
        })),
      });
      versionedUpdatedAt.set(row.paragraphIndex, row.updatedAt);
    }
    const legacyRows = await db.select().from(highlights).where(and(
      eq(highlights.ownerId, owner),
      eq(highlights.articleId, articleId),
    )).all();
    const legacy = legacyRows.map(rowToHighlight)
      .filter((record) => record.styles.length > 0 && record.start < record.end)
      .sort((left, right) => left.paragraphIndex - right.paragraphIndex
        || left.createdAt - right.createdAt
        || left.id.localeCompare(right.id));
    const legacyByParagraph = new Map<number, Highlight[]>();
    for (const record of legacy) {
      const records = legacyByParagraph.get(record.paragraphIndex) ?? [];
      records.push(record);
      legacyByParagraph.set(record.paragraphIndex, records);
    }
    for (const [paragraphIndex, records] of legacyByParagraph) {
      const current = data.get(paragraphIndex);
      const legacyUpdatedAt = Math.max(...records.map((record) => record.createdAt));
      if (current && legacyUpdatedAt <= (versionedUpdatedAt.get(paragraphIndex) ?? 0)) continue;
      data.set(paragraphIndex, {
        paragraphIndex,
        version: current?.version ?? 0,
        highlights: records,
      });
    }
    return c.json({
      ok: true,
      data: [...data.values()].sort((left, right) => left.paragraphIndex - right.paragraphIndex),
    });
  });

  r.post("/", (c) => c.json(RETIRED_HIGHLIGHT_API_ERROR, 410));

  r.delete("/:id", (c) => c.json(RETIRED_HIGHLIGHT_API_ERROR, 410));

  return r;
}
