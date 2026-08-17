# -*- coding: utf-8 -*-
"""HTTP 基础层单测：纯函数 + 用 httpx.MockTransport 测 fetch 相关路径。"""
import datetime as dt

import httpx

from kaogong.http import (
    IndexedLink,
    _parse_ymd,
    abs_url,
    anchors,
    clean,
    fetch,
    list_pages,
    page_pub_date,
    paragraphs,
    pick_by_date,
    pick_exact,
    pick_past_by_date,
    pick_quotes,
    strip_outer_quotes,
)


def test_clean_strips_tags_and_whitespace():
    assert clean("<p>  你好 <b>世界</b>  </p>") == "你好 世界"


def test_clean_unescapes_entities():
    assert clean("a&amp;b") == "a&b"


def test_anchors_filters_static_and_empty():
    html = '<a href="/a/1.html">标题一</a><a href="x.css">css</a><a href=""></a>'
    assert anchors(html) == [("/a/1.html", "标题一")]


def test_abs_url_variants():
    assert abs_url("/n1/x.html", "https://people.com.cn/a/") == "https://people.com.cn/n1/x.html"
    assert abs_url("//cdn.x/y.js", "https://a.com/") == "https://cdn.x/y.js"
    assert abs_url("https://x.com/z", "https://a.com/") == "https://x.com/z"


def test_paragraphs_filters_short():
    body = "<p>短</p><p>" + "长" * 40 + "</p>"
    assert len(paragraphs(body)) == 1


def test_strip_outer_quotes():
    assert strip_outer_quotes("\u201c你好\u201d") == "你好"
    assert strip_outer_quotes('"你好"') == "你好"


def test_parse_ymd_variants():
    assert _parse_ymd("2026-07-31") == dt.date(2026, 7, 31)
    assert _parse_ymd("2026/07/31") == dt.date(2026, 7, 31)


def test_pick_by_date_prefers_exact():
    target = dt.date(2026, 8, 12)
    items = [
        IndexedLink(dt.date(2026, 8, 11), "a", "u1"),
        IndexedLink(dt.date(2026, 8, 12), "b", "u2"),
        IndexedLink(dt.date(2026, 8, 10), "c", "u3"),
    ]
    assert pick_by_date(items, target, 2)[0].url == "u2"


def test_pick_exact_only_same_day():
    target = dt.date(2026, 8, 12)
    items = [IndexedLink(dt.date(2026, 8, 12), "b", "u2"), IndexedLink(dt.date(2026, 8, 11), "a", "u1")]
    assert [x.url for x in pick_exact(items, target, 5)] == ["u2"]


def test_pick_past_excludes_future():
    target = dt.date(2026, 8, 12)
    items = [IndexedLink(dt.date(2026, 8, 13), "f", "uf"), IndexedLink(dt.date(2026, 8, 12), "b", "u2")]
    assert [x.url for x in pick_past_by_date(items, target, 5)] == ["u2"]


def test_pick_quotes_prefers_quoted():
    quoted = "\u201c" + "今" * 20 + "\u201d"
    plain = "今" * 20
    q = pick_quotes([quoted + "。", plain + "。"], n=1)
    assert len(q) == 1
    assert q[0].startswith("\u201c")


def test_fetch_decodes_utf8():
    def handler(request):
        return httpx.Response(
            200,
            content="<html>你好</html>".encode("utf-8"),
            headers={"content-type": "text/html; charset=utf-8"},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch("https://x.com/", client=client) == "<html>你好</html>"


def test_list_pages_dedups_by_url():
    html = '<a href="/n1/2026/0812/c1.html">标题</a><a href="/n1/2026/0812/c1.html">标题更长</a>'

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        items = list_pages("https://x.com/index.html", max_pages=1, client=client)
    assert len(items) == 1
    assert items[0].date == dt.date(2026, 8, 12)
    assert items[0].url == "https://x.com/n1/2026/0812/c1.html"


def test_page_pub_date_extracts():
    html = '<div>发布日期：2026-08-12 08:00</div>'

    def handler(request):
        return httpx.Response(200, text=html)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert page_pub_date("https://x.com/a", client=client) == dt.date(2026, 8, 12)
