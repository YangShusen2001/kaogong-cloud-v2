// 内容契约：Python 管道产出 → Astro 消费的领域模型。
// 字段名与结构对照原项目真实数据（data/每日材料/*.md、data/原文/*/*.json）提炼，
// 是“管道”与“前端”之间唯一的接口定义。
//
// ⚠️ 跨语言权威契约是 content/schema/*.json（JSON Schema）：
// Python 管道据此校验产出（pipeline/tests/test_content_schema.py）。
// 本文件的 TS 类型必须与其保持字段一致；后续会用“从 JSON Schema 生成 TS 类型”
// 或“一致性测试”消除手工同步（见 ADR 0001）。

/** 剪藏原文（对应原 data/原文/{date}/*.json）。 */
export interface ClippedArticle {
  /** 原文短 id，如 "14588442ca"。 */
  id: string;
  /** 所属日期，ISO 字符串 "2026-08-12"。 */
  date: string;
  title: string;
  /** 来源，如 "南方网"。 */
  source: string;
  /** 原文链接。 */
  url: string;
  /** 原文发布日期，可能为空字符串。 */
  pubDate: string;
  /** 抓取时间，ISO8601。 */
  fetchedAt: string;
  status: "ok" | "error";
  /** 正文段落。 */
  paragraphs: string[];
  /** 金句摘录。 */
  keySentences: string[];
}

/** 日报里的单条新闻。 */
export interface DigestItem {
  /** 条目标题。 */
  title: string;
  /** 日期短写，如 "08-12"。 */
  date: string;
  /** 原文链接。 */
  sourceUrl: string;
  /** 金句摘录（可选）。 */
  quotes?: string[];
}

/** 日报的一个栏目，如 "全国时政要闻" / "申论精读"。 */
export interface DigestSection {
  /** 栏目 slug，如 "national" / "essay"。 */
  id: string;
  /** 栏目名。 */
  title: string;
  items: DigestItem[];
}

/** 一份每日日报（对应原 data/每日材料/{date}.md）。 */
export interface DailyDigest {
  /** "2026-08-12"。 */
  date: string;
  /** "每日日报 · 2026-08-12（周三）"。 */
  title: string;
  sections: DigestSection[];
}
