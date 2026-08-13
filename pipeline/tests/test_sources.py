# -*- coding: utf-8 -*-
"""新闻源提取器单测（HTML fixture + httpx.MockTransport，不真实联网）。"""
import datetime as dt

import httpx

from kaogong.sources import SOURCES, extract, fetch_source


def _source(slot: str):
    return next(s for s in SOURCES if s.slot == slot)


def _extract(slot: str, html: str):
    src = _source(slot)

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return extract(src, client=client)


def test_extract_gov_policy_yyyymm():
    html = (
        '<a href="/zhengce/content/202608/content_1.html">国务院政策标题一</a>'
        '<a href="/zhengce/content/202607/content_2.html">七月政策标题</a>'
    )
    items = _extract("gov", html)
    assert len(items) == 2
    assert items[0].date == dt.date(2026, 8, 1)
    assert items[0].url == "https://www.gov.cn/zhengce/content/202608/content_1.html"


def test_extract_qstheory_yyyymmdd():
    html = '<a href="/20260812/abc123def/c.html">求是文章标题</a>'
    items = _extract("qst", html)
    assert len(items) == 1
    assert items[0].date == dt.date(2026, 8, 12)


def test_extract_renmin_title_drop():
    html = (
        '<a href="/n1/2026/0812/c1.html">人民日报评论标题</a>'
        '<a href="/n1/2026/0812/c2.html">网友热议：某某话题</a>'
    )
    items = _extract("rm", html)
    assert len(items) == 1
    assert items[0].date == dt.date(2026, 8, 12)


def test_extract_dayoo_three_groups():
    html = '<a href="/guangdong/202608/12/abc.html">广东要闻标题</a>'
    items = _extract("gd", html)
    assert len(items) == 1
    assert items[0].date == dt.date(2026, 8, 12)


def test_extract_failure_returns_empty():
    def handler(request):
        return httpx.Response(500, text="error")

    src = _source("qst")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert extract(src, client=client) == []


def test_fetch_source_assigns_slot():
    src = _source("gov")
    html = '<a href="/zhengce/content/202608/content_1.html">标题</a>'

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        cands = fetch_source(src, client=client)
    assert len(cands) == 1
    assert cands[0].slot == "gov"
    assert cands[0].date == dt.date(2026, 8, 1)
