import { describe, expect, it } from "vitest";
import { applyStyle, buildSegments, removeRange, removeStyle, segmentsToHtml, type Span } from "./highlights";
import { buildReaderSegments, readerSegmentsToHtml, validAiAnnotations } from "./reader-annotations";

describe("applyStyle", () => {
  it("在空集上应用样式生成单区间", () => {
    expect(applyStyle([], { start: 0, end: 4 }, "green")).toEqual([
      { start: 0, end: 4, styles: ["green"] },
    ]);
  });

  it("同区间叠加第二种样式（荧光笔 + 下划线）", () => {
    let spans = applyStyle([], { start: 2, end: 5 }, "green");
    spans = applyStyle(spans, { start: 2, end: 5 }, "underline");
    expect(spans).toEqual([{ start: 2, end: 5, styles: ["green", "underline"] }]);
  });

  it("重叠区间按覆盖求并集并切分", () => {
    let spans = applyStyle([], { start: 0, end: 6 }, "green");
    spans = applyStyle(spans, { start: 4, end: 8 }, "underline");
    expect(spans).toEqual([
      { start: 0, end: 4, styles: ["green"] },
      { start: 4, end: 6, styles: ["green", "underline"] },
      { start: 6, end: 8, styles: ["underline"] },
    ]);
  });

  it("重复应用相同样式去重", () => {
    let spans = applyStyle([], { start: 0, end: 3 }, "green");
    spans = applyStyle(spans, { start: 0, end: 3 }, "green");
    expect(spans).toEqual([{ start: 0, end: 3, styles: ["green"] }]);
  });
});

describe("AI 与用户标注合并渲染", () => {
  const termExplanation = "这一政策术语强调跨部门协同配置资源，以制度衔接提升公共治理的整体效能。";
  const annotations = [
    { id: "v1", paragraphIndex: 0, start: 0, end: 4, text: "治理能力", type: "viewpoint" as const },
    { id: "e1", paragraphIndex: 0, start: 2, end: 6, text: "能力现代", type: "exam_point" as const },
    { id: "t1", paragraphIndex: 0, start: 4, end: 8, text: "现代化建", type: "term" as const, explanation: termExplanation },
  ];

  it("按所有边界切分并同时保留 AI 与用户样式", () => {
    const html = readerSegmentsToHtml(buildReaderSegments(
      "治理能力现代化建设",
      [{ start: 3, end: 7, styles: ["green"] }],
      annotations,
    ));
    expect(html).toContain('class="hl-green ai-viewpoint ai-exam-point"');
    expect(html).toContain('class="hl-green ai-exam-point ai-term"');
    expect(html).toContain('data-user-highlight="true"');
    expect(html).toContain(`data-explanation="${termExplanation}"`);
    expect(html).toContain('tabindex="0"');
  });

  it("原文模式不传 AI 区间时仍保留用户标注", () => {
    const html = readerSegmentsToHtml(buildReaderSegments(
      "治理能力现代化建设",
      [{ start: 0, end: 4, styles: ["underline"] }],
      [],
    ));
    expect(html).toContain("hl-underline");
    expect(html).not.toContain("ai-");
  });

  it("丢弃越界或与原文不一致的 AI 标注", () => {
    expect(validAiAnnotations("治理能力", [
      { id: "bad", paragraphIndex: 0, start: 0, end: 2, text: "错误", type: "term" },
      { id: "outside", paragraphIndex: 0, start: 0, end: 20, text: "治理能力", type: "viewpoint" },
    ])).toEqual([]);
  });
});

describe("removeRange", () => {
  it("移除区间内所有样式并保留两侧", () => {
    const spans: Span[] = [{ start: 0, end: 10, styles: ["green"] }];
    expect(removeRange(spans, { start: 3, end: 7 })).toEqual([
      { start: 0, end: 3, styles: ["green"] },
      { start: 7, end: 10, styles: ["green"] },
    ]);
  });

  it("完全覆盖时清空", () => {
    const spans: Span[] = [{ start: 0, end: 10, styles: ["green"] }];
    expect(removeRange(spans, { start: 0, end: 10 })).toEqual([]);
  });
});

describe("removeStyle", () => {
  it("只移除指定样式并保留其他样式", () => {
    const spans: Span[] = [{ start: 0, end: 10, styles: ["green", "underline"] }];
    expect(removeStyle(spans, { start: 3, end: 7 }, "underline")).toEqual([
      { start: 0, end: 3, styles: ["green", "underline"] },
      { start: 3, end: 7, styles: ["green"] },
      { start: 7, end: 10, styles: ["green", "underline"] },
    ]);
  });
});

describe("buildSegments / segmentsToHtml", () => {
  it("无样式时返回整段文本", () => {
    const segs = buildSegments("abcdef", []);
    expect(segs).toEqual([{ text: "abcdef", styles: [] }]);
    expect(segmentsToHtml(segs)).toBe("abcdef");
  });

  it("按区间切分并包裹 <mark>（叠加样式）", () => {
    const spans: Span[] = [{ start: 2, end: 5, styles: ["green", "underline"] }];
    expect(segmentsToHtml(buildSegments("abcdef", spans))).toBe(
      'ab<mark class="hl-green hl-underline">cde</mark>f',
    );
  });

  it("转义 HTML 特殊字符", () => {
    const spans: Span[] = [{ start: 0, end: 3, styles: ["green"] }];
    expect(segmentsToHtml(buildSegments("<a&b", spans))).toBe(
      '<mark class="hl-green">&lt;a&amp;</mark>b',
    );
  });
});
