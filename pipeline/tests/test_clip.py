# -*- coding: utf-8 -*-
"""剪藏原文单测：正文提取 / 标题提取 / 来源 / 日期。"""
import httpx

from kaogong.clip import clip_article, extract_paragraphs, extract_title, source_of, url_date


def _para(text, n=20):
    return "<p>" + text * n + "</p>"


def test_extract_paragraphs_container():
    html = (
        '<html><body>'
        '<div id="content">'
        + _para("正文第一段，")
        + _para("正文第二段，")
        + "<p>责任编辑：某</p>"
        "</div>"
        "<div>" + _para("相关新闻标题内容很长") + "</div>"
        "</body></html>"
    )
    paras, method = extract_paragraphs(html)
    assert method == "container-markers"
    assert len(paras) == 2
    assert "正文第一段" in paras[0]


def test_extract_title_h1():
    assert extract_title("<h1>这是标题</h1>", "回退") == "这是标题"


def test_extract_title_fallback():
    assert extract_title("<div>无标题</div>", "回退标题") == "回退标题"


def test_source_of():
    assert source_of("https://www.people.com.cn/n1/x.html") == "人民网"
    assert source_of("https://www.gd.gov.cn/x") == "广东省人民政府网"


def test_url_date():
    assert url_date("https://x.com/n1/2026/0812/c1.html") == "2026-08-12"


def test_clip_article_ok():
    def handler(request):
        return httpx.Response(
            200,
            text=(
                "<html><body><h1>测试标题</h1>"
                '<div id="content">' + _para("正文第一段，") + _para("正文第二段，") + "</div>"
                "</body></html>"
            ),
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        clip = clip_article("https://www.people.com.cn/n1/2026/0812/c1.html", "旧标题", "2026-08-12", client=client)
    assert clip["status"] == "ok"
    assert clip["title"] == "测试标题"
    assert clip["source"] == "人民网"
    assert len(clip["paragraphs"]) == 2
