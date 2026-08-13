# -*- coding: utf-8 -*-
"""新闻源适配层：官方源列表页 → Candidate 列表。

设计（相对原 digest_sources.py 的 15 个复制粘贴函数）：
绝大多数源都是「抓列表页 → 匹配文章 URL 里的日期 → 得到 (date,title,url)」，
差异只在「URL 日期正则 + 日期解析 + 标题过滤」。因此抽成通用 extract()，
每个源 = 一个 Source 配置 + 一个解析日期的小函数，不再复制粘贴整段循环。

本模块先落地「URL 内嵌日期」这一大类源；
「URL 无日期、需抓文章页 page_pub_date」的源（gd/southcn/scol/xhby）用第二个提取器，随后补。
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Callable

import httpx

from .http import IndexedLink, abs_url, anchors, clean, fetch
from .models import Candidate

DateFn = Callable[[re.Match], dt.date | None]


# —— 日期解析小函数：每种 URL 日期形态一个（这是各源唯一需要手写的地方）——

def _ymd(m: re.Match) -> dt.date | None:
    """三组 year/month/day（可能不补零），如 dayoo / jiangsu。"""
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except (ValueError, IndexError):
        return None


def _yyyymm(m: re.Match) -> dt.date | None:
    """一组 YYYYMM（只到月，取当月 1 日），如 gov.cn。"""
    try:
        return dt.datetime.strptime(m.group(1), "%Y%m").date()
    except ValueError:
        return None


def _yyyymmdd(m: re.Match) -> dt.date | None:
    """一组 YYYYMMDD，如 qstheory / news.cn / banyuetan。"""
    try:
        return dt.datetime.strptime(m.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def _n1_yyyymmdd(m: re.Match) -> dt.date | None:
    """两组 year + monthday（/n1/YYYY/MMDD/），如 people.com.cn。"""
    try:
        return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d").date()
    except ValueError:
        return None


@dataclass(frozen=True)
class Source:
    """一个官方源的抓取配置。"""
    name: str
    slot: str                 # 栏目槽位（与 build.SLOT_SOURCE 对应）
    page: str                 # 列表页 URL
    href_re: str              # 匹配文章链接的正则（含日期捕获组）
    date_fn: DateFn           # 从正则匹配解析日期
    title_min: int = 1        # 标题最短字数
    title_drop: tuple[str, ...] = ()  # 命中这些子串的标题丢弃
    limit: int = 20           # 最多取多少条


SOURCES: tuple[Source, ...] = (
    Source("中国政府网政策", "gov", "https://www.gov.cn/zhengce/",
           r"/zhengce/content/(\d{6})/", _yyyymm, limit=8),
    Source("求是网", "qst", "http://www.qstheory.cn/",
           r"/(\d{8})/[0-9a-f]+/c\.html", _yyyymmdd, limit=6),
    Source("新华时评", "xh", "https://www.news.cn/depthobserve/xhsd.html",
           r"/(\d{8})/[0-9a-f]+/c\.html", _yyyymmdd, limit=6),
    Source("人民日报评论", "rm", "http://opinion.people.com.cn/GB/8213/49160/index.html",
           r"/n1/(\d{4})/(\d{4})/", _n1_yyyymmdd, limit=6, title_drop=("网友热议",)),
    Source("半月谈今日谈", "byt", "http://www.banyuetan.org/byt/jinritan/index.html",
           r"/jrt/detail/(\d{8})/", _yyyymmdd, limit=3),
    Source("大洋网广东", "gd", "https://www.dayoo.com/",
           r"/guangdong/(\d{4})(\d{2})/(\d{2})/", _ymd, limit=6),
    Source("江苏政府网要闻", "js", "http://www.jiangsu.gov.cn/col/col84322/index.html",
           r"/art/(\d{4})/(\d{1,2})/(\d{1,2})/", _ymd, limit=6),
)


def extract(source: Source, *, client: httpx.Client | None = None) -> list[IndexedLink]:
    """通用提取器：抓列表页 → 匹配 URL 日期 → 清洗/过滤标题 → 去重。"""
    try:
        text = fetch(source.page, client=client)
    except Exception:
        return []
    out: list[IndexedLink] = []
    seen_titles: set[str] = set()
    for href, txt in anchors(text):
        m = re.search(source.href_re, href)
        if not m:
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


def fetch_source(source: Source, *, client: httpx.Client | None = None) -> list[Candidate]:
    """抓一个源，产出带槽位的 Candidate 列表（交给 build_digest 组装）。"""
    return [
        Candidate(title=l.title, url=l.url, date=l.date, slot=source.slot)
        for l in extract(source, client=client)
    ]
