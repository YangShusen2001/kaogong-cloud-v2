# -*- coding: utf-8 -*-
"""新闻源适配层：官方源列表页 → Candidate 列表。

三大类源（按「日期怎么来」划分）：
- url        日期内嵌在文章 URL 里（如 /20260812/），直接解析；
- list_pages 人民网式多页频道（index.html → index{i}.html），复用 http.list_pages；
- pubdate    URL 无精确日期（如 gd.gov.cn、南方网），抓文章页 page_pub_date 取日期，
             锚文本 min/max 得标题/摘要；取不到日期时可用 fallback（如 gov/scol 回退到当月 1 日）。

设计：抽成配置表 + 通用提取器，新增源 = 加一行 Source 配置。
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Callable

import httpx

from .http import IndexedLink, abs_url, anchors, clean, fetch, list_pages, page_pub_date
from .models import Candidate

DateFn = Callable[[re.Match], dt.date | None]
FallbackFn = Callable[[str], dt.date | None]


# —— 日期解析小函数（URL 内嵌日期源用，每种 URL 形态一个）——

def _ymd(m: re.Match) -> dt.date | None:
    """三组 year/month/day（可能不补零），如 dayoo / jiangsu。"""
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except (ValueError, IndexError):
        return None


def _yyyymmdd(m: re.Match) -> dt.date | None:
    """一组 YYYYMMDD，如 qstheory / news.cn / banyuetan。"""
    try:
        return dt.datetime.strptime(m.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def _n1_yyyymmdd(m: re.Match) -> dt.date | None:
    """两组 year + monthday（/n1/YYYY/MMDD/），如 people.com.cn 详情页。"""
    try:
        return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d").date()
    except ValueError:
        return None


# —— pubdate 源的日期回退：URL 里只有年月，抓不到精确日期时退回当月 1 日 ——

def _month_first(regex: str) -> FallbackFn:
    def fn(url: str) -> dt.date | None:
        m = re.search(regex, url)
        if not m:
            return None
        try:
            return dt.datetime.strptime(m.group(1), "%Y%m").date()
        except ValueError:
            return None
    return fn


@dataclass(frozen=True)
class Source:
    """一个官方源的抓取配置。"""
    name: str
    slot: str                 # 栏目槽位（与 build.SLOT_SOURCE 对应）
    page: str                 # 列表页 URL
    href_re: str = ""         # 匹配文章链接的正则
    mode: str = "url"         # url | list_pages | pubdate
    date_fn: DateFn | None = None          # mode=url：从匹配解析日期
    fallback_date_fn: FallbackFn | None = None  # mode=pubdate：日期回退
    title_min: int = 1
    title_drop: tuple[str, ...] = ()
    limit: int = 20
    max_pages: int = 6        # mode=list_pages


SOURCES: tuple[Source, ...] = (
    # —— URL 内嵌精确日期 ——
    Source("求是网", "qst", "http://www.qstheory.cn/",
           r"/(\d{8})/[0-9a-f]+/c\.html", date_fn=_yyyymmdd, limit=6),
    Source("新华时评", "xh", "https://www.news.cn/depthobserve/xhsd.html",
           r"/(\d{8})/[0-9a-f]+/c\.html", date_fn=_yyyymmdd, limit=6),
    Source("人民日报评论", "rm", "http://opinion.people.com.cn/GB/8213/49160/index.html",
           r"/n1/(\d{4})/(\d{4})/", date_fn=_n1_yyyymmdd, limit=6, title_drop=("网友热议",)),
    Source("半月谈今日谈", "byt", "http://www.banyuetan.org/byt/jinritan/index.html",
           r"/jrt/detail/(\d{8})/", date_fn=_yyyymmdd, limit=3),
    Source("大洋网广东", "gd", "https://www.dayoo.com/",
           r"/guangdong/(\d{4})(\d{2})/(\d{2})/", date_fn=_ymd, limit=6),
    Source("江苏政府网要闻", "js", "http://www.jiangsu.gov.cn/col/col84322/index.html",
           r"/art/(\d{4})/(\d{1,2})/(\d{1,2})/", date_fn=_ymd, limit=6),

    # —— 人民网多页频道（list_pages）——
    Source("人民网时政", "pol", "https://politics.people.com.cn/GB/1024/index.html",
           mode="list_pages", limit=12),
    Source("人民网时评", "shi", "http://opinion.people.com.cn/GB/223228/index.html",
           mode="list_pages", limit=8, max_pages=3),

    # —— URL 无精确日期：抓文章页取发布日期 ——
    Source("中国政府网政策", "gov", "https://www.gov.cn/zhengce/",
           r"/zhengce/content/(\d{6})/", mode="pubdate",
           fallback_date_fn=_month_first(r"/zhengce/content/(\d{6})/"), limit=8),
    Source("广东政府网要闻", "gd", "https://www.gd.gov.cn/gdywdt/",
           r"/content/post_", mode="pubdate", limit=4),
    Source("广东政策解读", "gdp", "https://www.gd.gov.cn/zwgk/zcjd/",
           r"/content/post_", mode="pubdate", limit=8),
    Source("南方时评", "nf", "https://opinion.southcn.com/",
           r"opinion\.southcn\.com/node_", mode="pubdate", limit=3),
    Source("四川全媒快讯", "sc", "https://sichuan.scol.com.cn/ggxw/",
           r"ggxw/(\d{6})/", mode="pubdate",
           fallback_date_fn=_month_first(r"ggxw/(\d{6})/"), limit=6),
    Source("天府评论", "sc", "https://comment.scol.com.cn/",
           r"comment\.scol\.com\.cn", mode="pubdate", limit=4),
    Source("交汇点时评", "js", "https://www.xhby.net/xpinglun/",
           r"/content/", mode="pubdate", title_drop=("举报", "联系我们"), limit=4),
)


def extract(source: Source, *, client: httpx.Client | None = None) -> list[IndexedLink]:
    """通用提取器（mode=url）：抓列表页 → 匹配 URL 日期 → 清洗/过滤标题 → 去重。"""
    try:
        text = fetch(source.page, client=client)
    except Exception:
        return []
    out: list[IndexedLink] = []
    seen_titles: set[str] = set()
    for href, txt in anchors(text):
        m = re.search(source.href_re, href)
        if not m or source.date_fn is None:
            continue
        d = source.date_fn(m)
        if d is None:
            continue
        t = clean(txt)
        if not t or len(t) < source.title_min:
            continue
        if any(x in t for x in source.title_drop):
            continue
        if t in seen_titles:
            continue
        seen_titles.add(t)
        out.append(IndexedLink(d, t, abs_url(href, source.page)))
        if len(out) >= source.limit:
            break
    return out


def _extract_pubdate(source: Source, *, client: httpx.Client | None = None) -> list[Candidate]:
    """pubdate 提取器：锚文本 min/max 得标题/摘要，抓文章页取精确发布日期。"""
    try:
        text = fetch(source.page, client=client)
    except Exception:
        return []
    by_url: dict[str, list[str]] = {}
    for href, txt in anchors(text):
        if not re.search(source.href_re, href):
            continue
        t = clean(txt)
        if not t or any(x in t for x in source.title_drop):
            continue
        by_url.setdefault(abs_url(href, source.page), []).append(t)
    out: list[Candidate] = []
    for u, ts in by_url.items():
        if not ts:
            continue
        title = min(ts, key=len)
        summary = max(ts, key=len)
        if summary == title:
            summary = ""
        d = page_pub_date(u, client=client)
        if d is None and source.fallback_date_fn is not None:
            d = source.fallback_date_fn(u)
        if d is None:
            continue
        out.append(Candidate(title=title, url=u, date=d, slot=source.slot, summary=summary))
        if len(out) >= source.limit:
            break
    return out


def fetch_source(source: Source, *, client: httpx.Client | None = None) -> list[Candidate]:
    """抓一个源，产出带槽位的 Candidate 列表（交给 build_digest 组装）。"""
    if source.mode == "pubdate":
        return _extract_pubdate(source, client=client)
    if source.mode == "list_pages":
        links = list_pages(source.page, source.max_pages, client=client)
        return [
            Candidate(title=l.title, url=l.url, date=l.date, slot=source.slot)
            for l in links[:source.limit]
        ]
    return [
        Candidate(title=l.title, url=l.url, date=l.date, slot=source.slot)
        for l in extract(source, client=client)
    ]
