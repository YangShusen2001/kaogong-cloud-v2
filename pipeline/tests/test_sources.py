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
    src = _source("qst")
    html = '<a href="/20260812/abc123def/c.html">标题</a>'

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        cands = fetch_source(src, client=client)
    assert len(cands) == 1
    assert cands[0].slot == "qst"
    assert cands[0].date == dt.date(2026, 8, 12)


def test_pubdate_title_summary_and_date():
    """URL 无日期：抓文章页取日期，锚文本 min/max 得标题/摘要。"""
    src = _source("nf")

    def handler(request):
        if "node_" in request.url.path:
            return httpx.Response(200, text='<div>发布日期：2026-08-12 08:00</div>')
        return httpx.Response(
            200,
            text=(
                '<a href="https://opinion.southcn.com/node_123.shtml">短标题</a>'
                '<a href="https://opinion.southcn.com/node_123.shtml">这是更长的摘要文本内容</a>'
            ),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        cands = fetch_source(src, client=client)
    assert len(cands) == 1
    assert cands[0].date == dt.date(2026, 8, 12)
    assert cands[0].title == "短标题"
    assert cands[0].summary == "这是更长的摘要文本内容"
    assert cands[0].slot == "nf"


def test_pubdate_fallback_to_month_first():
    """gov.cn URL 只有年月，抓不到精确日期时回退当月 1 日。"""
    src = _source("gov")

    def handler(request):
        if "content_" in request.url.path:
            return httpx.Response(200, text="<div>无日期</div>")
        return httpx.Response(200, text='<a href="/zhengce/content/202608/content_1.html">政策标题</a>')

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        cands = fetch_source(src, client=client)
    assert len(cands) == 1
    assert cands[0].date == dt.date(2026, 8, 1)
