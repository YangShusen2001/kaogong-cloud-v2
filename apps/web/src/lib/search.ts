// 搜索索引：构建时把全部日报 + 剪藏原文扁平化成可检索条目，供搜索页客户端全文过滤。
import { listArticles, listDigests } from "./content";

export interface SearchEntry {
  date: string;
  section: string;
  title: string;
  sourceUrl: string;
  summary: string;
  href: string;
  external: boolean;
  body: string;
}

export function buildSearchIndex(): SearchEntry[] {
  const articleByUrl = new Map(listArticles().map((a) => [a.url, a]));
  return listDigests().flatMap((d) =>
    d.sections.flatMap((s) =>
      s.items.map((it) => {
        const article = articleByUrl.get(it.sourceUrl);
        const body = article
          ? [article.aiSummary ?? "", ...(article.keySentences ?? []), ...(article.paragraphs ?? [])].join(" ")
          : "";
        return {
          date: d.date,
          section: s.title,
          title: it.title,
          sourceUrl: it.sourceUrl,
          summary: it.summary ?? "",
          href: article ? `/read/${article.id}/` : it.sourceUrl,
          external: !article,
          body,
        };
      }),
    ),
  );
}
