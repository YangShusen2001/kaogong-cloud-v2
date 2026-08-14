import { describe, expect, it } from "vitest";
import { applyStyle, buildSegments, removeRange, segmentsToHtml, type Span } from "./highlights";

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
