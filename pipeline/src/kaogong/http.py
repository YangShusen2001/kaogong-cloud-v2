# -*- coding: utf-8 -*-
"""HTTP 抓取与正文提取基础层（移植自原 site_builder/digest_http.py 的通用部分）。

标准化改动（相对原实现）：
- urllib → httpx：标准 HTTP 客户端，可注入 mock 做测试、可扩展 async；
- 纯函数全部加类型标注 + 单测；
- 「索引条目」从裸元组 (date,title,url) 提升为 NamedTuple，字段有名字、不易错位。
"""
from __future__ import annotations

import datetime as dt
import html as ihtml
import re
import urllib.parse
from typing import NamedTuple

import httpx

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
TIMEOUT = 15.0


class IndexedLink(NamedTuple):
    """频道列表页里的一条链接：发布日期 + 标题 + 绝对 URL。"""
    date: dt.date
    title: str
    url: str


def _fetch_with(client: httpx.Client, url: str, limit: int) -> str:
    r = client.get(url)
    r.raise_for_status()
    raw = r.content[:limit]
    try:
        return raw.decode(r.encoding or "utf-8", "ignore")
    except LookupError:
        return raw.decode("utf-8", "ignore")


def fetch(url: str, *, client: httpx.Client | None = None, limit: int = 900_000) -> str:
    """抓取页面 HTML；按响应头编码回退 UTF-8。client 可注入（测试用 mock）。"""
    if client is not None:
        return _fetch_with(client, url, limit)
    with httpx.Client(headers=HEADERS, timeout=TIMEOUT, follow_redirects=True) as c:
        return _fetch_with(c, url, limit)


def clean(s: str) -> str:
    """去标签、反转义、压空白。"""
    s = re.sub(r"<[^>]+>", "", s or "")
    s = ihtml.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def anchors(html_text: str) -> list[tuple[str, str]]:
    """抽取 <a href> 的 (href, 文本)，过滤静态资源与空链接。"""
    out: list[tuple[str, str]] = []
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html_text, re.S):
        href = ihtml.unescape(m.group(1)).strip()
        txt = clean(m.group(2))
        if not href or not txt:
            continue
        if any(x in href for x in (".css", ".js", ".jpg", ".png", "javascript:")):
            continue
        out.append((href, txt))
    return out


def abs_url(href: str, page_url: str) -> str:
    if href.startswith(("http://", "https://")):
        return href
    if href.startswith("//"):
        return "https:" + href
    return urllib.parse.urljoin(page_url, href)


def paragraphs(body: str, minlen: int = 35) -> list[str]:
    """抽取 <p> 段落并清洗，过滤过短段落。"""
    out = []
    for p in re.findall(r"<p[^>]*>(.*?)</p>", body, re.S):
        t = clean(p)
        if len(t) >= minlen:
            out.append(t)
    return out


def strip_outer_quotes(s: str) -> str:
    """去掉首尾成对的中英文引号。"""
    s = s.strip()
    if len(s) >= 2 and (
        (s[0] == "\u201c" and s[-1] == "\u201d")
        or (s[0] == '"' and s[-1] == '"')
    ):
        return s[1:-1].strip()
    return s


def pick_quotes(ps: list[str], n: int = 2) -> list[str]:
    """从段落里挑金句：优先含引号的完整句，不足时用中等长度句子补。"""
    quotes: list[str] = []
    for p in ps:
        for s in re.split(r"(?<=[。！？!?])", p):
            s = s.strip()
            if 18 <= len(s) <= 140 and "\u201c" in s and s not in quotes:
                quotes.append(s)
    if len(quotes) < n:
        for p in ps:
            s = p.strip()
            if 30 <= len(s) <= 140 and s not in quotes:
                quotes.append(s)
    return [strip_outer_quotes(q) for q in quotes[:n]]


def _parse_ymd(s: str) -> dt.date:
    """解析 2026-07-31 / 2026/07/31 / 2026.07.31 等日期串。"""
    s = re.sub(r"[/.]", "-", s.strip())
    return dt.datetime.strptime(s, "%Y-%m-%d").date()


def pick_by_date(items: list[IndexedLink], target: dt.date, max_items: int) -> list[IndexedLink]:
    """优先取与 target 同日的条目，不足用最近日期补。"""
    if not items:
        return []
    items = sorted(items, key=lambda x: (abs((x.date - target).days), -x.date.toordinal(), x.title))
    exact = [x for x in items if x.date == target]
    rest = [x for x in items if x.date != target]
    out = exact[:max_items]
    for x in rest:
        if len(out) >= max_items:
            break
        out.append(x)
    out.sort(key=lambda x: (abs((x.date - target).days), -x.date.toordinal()))
    return out[:max_items]


def pick_past_by_date(items: list[IndexedLink], target: dt.date, max_items: int) -> list[IndexedLink]:
    """只允许发布日期 <= 目标日期（避免补历史时混入未来文章）。"""
    past = [x for x in items if x.date <= target]
    return pick_by_date(past, target, max_items)


def pick_exact(items: list[IndexedLink], target: dt.date, max_items: int) -> list[IndexedLink]:
    """只选择发布日期 == 目标日期的条目（单日刊只放当天新闻）。"""
    exact = [x for x in items if x.date == target]
    exact.sort(key=lambda x: x.date, reverse=True)
    return exact[:max_items]


def list_pages(
    base_url: str, max_pages: int = 6, *, client: httpx.Client | None = None
) -> list[IndexedLink]:
    """抓取频道列表前几页，按 URL 去重（同名取更长标题）。"""
    by_url: dict[str, IndexedLink] = {}
    for i in range(max_pages):
        page_url = base_url if i == 0 else re.sub(r"index\.html$", f"index{i}.html", base_url)
        try:
            text = fetch(page_url, client=client)
        except Exception:
            break
        added = 0
        for href, txt in anchors(text):
            m = re.search(r"/n1/(\d{4})/(\d{4})/", href)
            if not m:
                continue
            try:
                d = dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d").date()
            except ValueError:
                continue
            t = clean(txt)
            if not t:
                continue
            u = abs_url(href, page_url)
            cur = by_url.get(u)
            if cur is None:
                by_url[u] = IndexedLink(d, t, u)
                added += 1
            elif len(t) > len(cur.title):
                by_url[u] = IndexedLink(d, t, u)
        if added == 0:
            break
    return list(by_url.values())


def page_pub_date(url: str, *, client: httpx.Client | None = None) -> dt.date | None:
    """从文章页提取发布日期，取不到返回 None。"""
    try:
        text = fetch(url, client=client, limit=400_000)
        for pat in (
            r"(?:发布日期|发布时间)[^0-9]{0,20}(20\d{2}[/-]\d{1,2}[/-]\d{1,2})",
            r"(20\d{2}[/-]\d{1,2}[/-]\d{1,2})",
        ):
            m = re.search(pat, text)
            if m:
                return _parse_ymd(m.group(1))
    except Exception:
        pass
    return None
