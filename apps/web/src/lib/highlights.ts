// 划线区间纯函数：以「段落内字符偏移」为唯一事实源，支持样式叠加（荧光笔 + 下划线）。
// 所有函数为纯函数，不依赖 DOM，便于单测；渲染与持久化都基于这里产出的规范化区间。
import type { HighlightStyle } from "@kaogong/contracts";

/** 一段非重叠的高亮区间（段落内字符偏移）。 */
export interface Span {
  /** 起始偏移（含）。 */
  start: number;
  /** 结束偏移（不含）。 */
  end: number;
  /** 该区间的样式集合，去重且按字典序稳定排序。 */
  styles: HighlightStyle[];
}

/** 样式集合规范化：去重 + 稳定排序，保证区间比较确定性。 */
function normalizeStyles(styles: Iterable<HighlightStyle>): HighlightStyle[] {
  return [...new Set(styles)].sort();
}

function sameStyles(a: HighlightStyle[], b: HighlightStyle[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** 合并相邻且样式完全相同的区间，并按 start 升序排序。 */
function mergeAdjacent(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    if (s.start >= s.end || s.styles.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.end === s.start && sameStyles(last.styles, s.styles)) {
      last.end = s.end;
    } else {
      out.push({ start: s.start, end: s.end, styles: [...s.styles] });
    }
  }
  return out;
}

/** 在区间上应用一种样式，与既有区间求并集，返回规范化（非重叠）区间集。 */
export function applyStyle(spans: Span[], range: { start: number; end: number }, style: HighlightStyle): Span[] {
  if (range.start >= range.end) return spans;
  const combined = [...spans, { start: range.start, end: range.end, styles: [style] }];
  const boundaries = new Set<number>();
  for (const s of combined) {
    boundaries.add(s.start);
    boundaries.add(s.end);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const result: Span[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const styles = new Set<HighlightStyle>();
    for (const s of combined) {
      if (s.start <= a && b <= s.end) for (const st of s.styles) styles.add(st);
    }
    if (styles.size > 0) result.push({ start: a, end: b, styles: normalizeStyles(styles) });
  }
  return mergeAdjacent(result);
}

/** 移除区间内的全部样式，保留两侧未被覆盖的部分。 */
export function removeRange(spans: Span[], range: { start: number; end: number }): Span[] {
  if (range.start >= range.end) return spans;
  const result: Span[] = [];
  for (const s of spans) {
    if (s.end <= range.start || s.start >= range.end) {
      result.push(s);
      continue;
    }
    if (s.start < range.start) result.push({ start: s.start, end: range.start, styles: [...s.styles] });
    if (s.end > range.end) result.push({ start: range.end, end: s.end, styles: [...s.styles] });
    // 与 range 重叠的部分被丢弃
  }
  return mergeAdjacent(result);
}

/** 仅移除区间内的一种样式，保留同区间的其他样式。 */
export function removeStyle(
  spans: Span[],
  range: { start: number; end: number },
  style: HighlightStyle,
): Span[] {
  if (range.start >= range.end) return spans;
  const boundaries = new Set<number>([range.start, range.end]);
  for (const span of spans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const result: Span[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]!;
    const end = sorted[i + 1]!;
    const styles = new Set<HighlightStyle>();
    for (const span of spans) {
      if (span.start <= start && end <= span.end) {
        for (const current of span.styles) styles.add(current);
      }
    }
    if (range.start <= start && end <= range.end) styles.delete(style);
    if (styles.size) result.push({ start, end, styles: normalizeStyles(styles) });
  }
  return mergeAdjacent(result);
}

/** 渲染片段：一段文本及其样式集合（无样式时 styles 为空）。 */
export interface Segment {
  text: string;
  styles: HighlightStyle[];
}

/** 把段落文本按区间切分为渲染片段。 */
export function buildSegments(text: string, spans: Span[]): Segment[] {
  const boundaries = new Set<number>([0, text.length]);
  for (const s of spans) {
    boundaries.add(Math.min(Math.max(s.start, 0), text.length));
    boundaries.add(Math.min(Math.max(s.end, 0), text.length));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a === b) continue;
    const styles = new Set<HighlightStyle>();
    for (const s of spans) {
      if (s.start <= a && b <= s.end) for (const st of s.styles) styles.add(st);
    }
    segments.push({ text: text.slice(a, b), styles: normalizeStyles(styles) });
  }
  return segments;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 渲染片段为 HTML：带样式的片段包裹 <mark class="hl-…">。 */
export function segmentsToHtml(segments: Segment[]): string {
  return segments
    .map((seg) => {
      const text = escapeHtml(seg.text);
      if (seg.styles.length === 0) return text;
      const cls = seg.styles.map((s) => `hl-${s}`).join(" ");
      return `<mark class="${cls}">${text}</mark>`;
    })
    .join("");
}
