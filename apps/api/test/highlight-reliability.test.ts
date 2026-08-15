import type { HighlightParagraphListItem, HighlightParagraphResponse } from "@kaogong/contracts";
import { describe, expect, it } from "vitest";
import { headers, json, makeContext, readJson } from "./helpers";

const ARTICLE_ID = "reliability-article";

function paragraphBody(baseVersion: number, text = "可靠划线") {
  return {
    articleId: ARTICLE_ID,
    paragraphIndex: 2,
    baseVersion,
    spans: [{ text, note: "备注", styles: ["green", "underline"], start: 1, end: 5 }],
  };
}

function emptyParagraphBody(baseVersion: number) {
  return { ...paragraphBody(baseVersion), spans: [] };
}

function insertLegacyHighlight(
  sqlite: ReturnType<typeof makeContext>["sqlite"],
  paragraphIndex: number,
  id = `legacy-${paragraphIndex}`,
) {
  sqlite.prepare(`
    INSERT INTO highlights
      (id, owner_id, article_id, text, note, styles, paragraph_index, start_offset, end_offset, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, "device:legacy-owner", ARTICLE_ID, id === "legacy-id" ? "旧划线" : `旧划线-${paragraphIndex}`, "旧备注", '["yellow"]', paragraphIndex, 2, 5, 123);
}

describe("highlight paragraph reliability", () => {
  it("retires legacy creation without inserting a physical highlight row", async () => {
    const { app, sqlite } = makeContext();

    const response = await app.request("/api/highlights", json("POST", {
      articleId: ARTICLE_ID,
      text: "旧写入",
      styles: ["green"],
      paragraphIndex: 0,
      start: 0,
      end: 3,
    }));

    expect(response.status).toBe(410);
    expect((await readJson<never>(response)).error?.code).toBe("HIGHLIGHT_API_RETIRED");
    expect(sqlite.prepare("SELECT count(*) AS count FROM highlights").get()).toEqual({ count: 0 });
  });

  it("retires legacy deletion without removing a physical highlight row", async () => {
    const { app, sqlite } = makeContext();
    insertLegacyHighlight(sqlite, 1, "legacy-delete-target");

    const response = await app.request("/api/highlights/legacy-delete-target", {
      method: "DELETE",
      headers: headers("legacy-owner"),
    });

    expect(response.status).toBe(410);
    expect((await readJson<never>(response)).error?.code).toBe("HIGHLIGHT_API_RETIRED");
    expect(sqlite.prepare("SELECT id, owner_id FROM highlights WHERE id = ?").get("legacy-delete-target"))
      .toEqual({ id: "legacy-delete-target", owner_id: "device:legacy-owner" });
  });

  it("returns a conflict without replacing the winning version when the base version is stale", async () => {
    const { app } = makeContext();
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(1, "已确认版本")));

    const stale = await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(1, "陈旧版本")));

    expect(stale.status).toBe(409);
    const listed = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers() });
    const paragraphs = (await readJson<HighlightParagraphListItem[]>(listed)).data;
    expect(paragraphs[0]?.version).toBe(2);
    expect(paragraphs[0]?.highlights[0]?.text).toBe("已确认版本");
  });

  it("allows exactly one of two concurrent initial claims", async () => {
    const { app } = makeContext();

    const responses = await Promise.all([
      app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0, "客户端甲"))),
      app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0, "客户端乙"))),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const listed = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers() });
    const paragraphs = (await readJson<HighlightParagraphListItem[]>(listed)).data;
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.version).toBe(1);
  });

  it("advances through create v1, empty tombstone v2, and recreation v3", async () => {
    const { app, sqlite } = makeContext();
    const created = await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));

    const removed = await app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(1)));
    const recreated = await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(2, "重新划线")));

    expect((await readJson<HighlightParagraphResponse>(created)).data.version).toBe(1);
    expect(removed.status).toBe(200);
    expect((await readJson<HighlightParagraphResponse>(removed)).data).toEqual({ version: 2, highlights: [] });
    expect((await readJson<HighlightParagraphResponse>(recreated)).data.version).toBe(3);
    expect(sqlite.prepare("SELECT version, spans FROM highlight_paragraphs").get()).toEqual({ version: 3, spans: JSON.stringify(paragraphBody(2, "重新划线").spans) });
  });

  it.each([0, 1])("rejects stale base version %s after an empty tombstone", async (baseVersion) => {
    const { app } = makeContext();
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));
    await app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(1)));

    const stale = await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(baseVersion, "陈旧重建")));

    expect(stale.status).toBe(409);
    const listed = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers() });
    expect((await readJson<HighlightParagraphListItem[]>(listed)).data).toEqual([{
      paragraphIndex: 2,
      version: 2,
      highlights: [],
    }]);
  });

  it.each([0, 1])("rejects a stale delete from base version %s after an empty tombstone", async (baseVersion) => {
    const { app } = makeContext();
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));
    await app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(1)));

    const stale = await app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(baseVersion)));

    expect(stale.status).toBe(409);
  });

  it("allows exactly one of two concurrent deletes from the same base version", async () => {
    const { app } = makeContext();
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));

    const responses = await Promise.all([
      app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(1))),
      app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(1))),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const successes = responses.filter((response) => response.status === 200);
    expect(successes).toHaveLength(1);
    const versions = await Promise.all(successes.map(async (response) =>
      (await readJson<HighlightParagraphResponse>(response)).data.version));
    expect(versions).toEqual([2]);
  });

  it.each([
    [{ text: "x", note: "", styles: ["green"], start: 3, end: 3 }],
    [{ text: "x", note: "", styles: [], start: 0, end: 1 }],
  ])("rejects an invalid span without creating state", async (spans) => {
    const { app, sqlite } = makeContext();

    const response = await app.request("/api/highlights/paragraph", json("PUT", {
      ...paragraphBody(0),
      spans,
    }));

    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT count(*) AS count FROM highlight_paragraphs").get()).toEqual({ count: 0 });
  });

  it("isolates paragraph state by owner", async () => {
    const { app } = makeContext();
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0), "owner-device-a"));

    const otherOwner = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, {
      headers: headers("owner-device-b"),
    });

    expect((await readJson<HighlightParagraphListItem[]>(otherOwner)).data).toEqual([]);
  });

  it("reads valid legacy highlight rows when no paragraph state exists", async () => {
    const { app, sqlite } = makeContext();
    insertLegacyHighlight(sqlite, 1, "legacy-id");

    const response = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, {
      headers: headers("legacy-owner"),
    });

    const paragraphs = (await readJson<HighlightParagraphListItem[]>(response)).data;
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.version).toBe(0);
    expect(paragraphs[0]?.highlights[0]).toMatchObject({
      id: "legacy-id",
      text: "旧划线",
      note: "旧备注",
      styles: ["yellow"],
      start: 2,
      end: 5,
    });
  });

  it("never resurrects a legacy row beneath a versioned tombstone", async () => {
    const { app, sqlite } = makeContext();
    insertLegacyHighlight(sqlite, 2);
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0), "legacy-owner"));

    await app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(1), "legacy-owner"));
    const response = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers("legacy-owner") });

    expect((await readJson<HighlightParagraphListItem[]>(response)).data).toEqual([{
      paragraphIndex: 2,
      version: 2,
      highlights: [],
    }]);
  });

  it("shows newer legacy content above an older versioned tombstone without resetting its version", async () => {
    const { app, sqlite } = makeContext();
    sqlite.prepare(`
      INSERT INTO highlight_paragraphs (owner_id, article_id, paragraph_index, version, spans, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("device:legacy-owner", ARTICLE_ID, 2, 7, "[]", 100);
    insertLegacyHighlight(sqlite, 2);
    sqlite.prepare("UPDATE highlights SET created_at = 200 WHERE id = ?").run("legacy-2");

    const response = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers("legacy-owner") });

    expect((await readJson<HighlightParagraphListItem[]>(response)).data).toEqual([expect.objectContaining({
      paragraphIndex: 2,
      version: 7,
      highlights: [expect.objectContaining({ id: "legacy-2" })],
    })]);
  });

  it("merges versioned and legacy state per paragraph in paragraph order", async () => {
    const { app, sqlite } = makeContext();
    insertLegacyHighlight(sqlite, 3);
    insertLegacyHighlight(sqlite, 3, "legacy-0");
    insertLegacyHighlight(sqlite, 1);

    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0), "legacy-owner"));
    const response = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers("legacy-owner") });

    const paragraphs = (await readJson<HighlightParagraphListItem[]>(response)).data;
    expect(paragraphs.map(({ paragraphIndex, version }) => ({ paragraphIndex, version }))).toEqual([
      { paragraphIndex: 1, version: 0 },
      { paragraphIndex: 2, version: 1 },
      { paragraphIndex: 3, version: 0 },
    ]);
    expect(paragraphs[1]?.highlights[0]?.text).toBe("可靠划线");
    expect(paragraphs[2]?.highlights.map(({ id }) => id)).toEqual(["legacy-0", "legacy-3"]);
  });

  it("lets an empty versioned row suppress only the same legacy paragraph", async () => {
    const { app, sqlite } = makeContext();
    insertLegacyHighlight(sqlite, 1);
    insertLegacyHighlight(sqlite, 2);

    const removed = await app.request("/api/highlights/paragraph", json("PUT", emptyParagraphBody(0), "legacy-owner"));

    const response = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers("legacy-owner") });

    expect((await readJson<HighlightParagraphResponse>(removed)).data).toEqual({ version: 1, highlights: [] });
    const paragraphs = (await readJson<HighlightParagraphListItem[]>(response)).data;
    expect(paragraphs.map(({ paragraphIndex, version, highlights }) => ({ paragraphIndex, version, highlights }))).toEqual([
      { paragraphIndex: 1, version: 0, highlights: [expect.objectContaining({ id: "legacy-1" })] },
      { paragraphIndex: 2, version: 1, highlights: [] },
    ]);
  });

  it.each(["not-json", JSON.stringify([{ text: "broken" }])])(
    "fails boundedly for malformed persisted spans instead of treating %s as deletion",
    async (spans) => {
      const { app, sqlite } = makeContext();
      insertLegacyHighlight(sqlite, 2);
      sqlite.prepare(`
        INSERT INTO highlight_paragraphs (owner_id, article_id, paragraph_index, version, spans, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("device:legacy-owner", ARTICLE_ID, 2, 7, spans, 456);

      const response = await app.request(`/api/highlights/paragraphs/${ARTICLE_ID}`, { headers: headers("legacy-owner") });

      expect(response.status).toBe(500);
      expect((await readJson<never>(response)).error?.code).toBe("HIGHLIGHT_STATE_INVALID");
      expect(sqlite.prepare("SELECT version, spans FROM highlight_paragraphs WHERE owner_id = ? AND article_id = ? AND paragraph_index = ?")
        .get("device:legacy-owner", ARTICLE_ID, 2)).toEqual({ version: 7, spans });
    },
  );
});
