// 搜索索引：构建时把全部日报扁平化成可检索条目，供搜索页客户端过滤。
import { listDigests } from "./content";

export interface SearchEntry {
  date: string;
  section: string;
  title: string;
  sourceUrl: string;
  summary: string;
}

export function buildSearchIndex(): SearchEntry[] {
  return listDigests().flatMap((d) =>
    d.sections.flatMap((s) =>
      s.items.map((it) => ({
        date: d.date,
        section: s.title,
        title: it.title,
        sourceUrl: it.sourceUrl,
        summary: it.summary ?? "",
      })),
    ),
  );
}
