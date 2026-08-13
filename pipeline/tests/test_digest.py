# -*- coding: utf-8 -*-
"""parse_daily_md 的回归测试，fixture 取自原项目真实每日材料。"""
from kaogong.digest import parse_daily_md

FIXTURE = """\
# 📖 每日日报 · 2026-08-12（周三）

## 全国时政要闻

- **习近平**就哥伦比亚发生强烈地震向哥伦比亚总统德拉埃斯普列亚致慰问电（08-12）[原文](https://politics.people.com.cn/n1/2026/0812/c1024-40777729.html)

## 申论精读

### 1. 壹时评：一碗拉面的“正名”之路（08-12）
[原文链接](http://opinion.people.com.cn/n1/2026/0812/c223228-40778377.html)

金句摘录：
> “近日，“兰州拉面”在天津、江苏等多地改名“青海拉面”，引发舆论热议。”
"""


def test_parse_title_and_date():
    d = parse_daily_md(FIXTURE)
    assert d.date == "2026-08-12"
    assert "2026-08-12" in d.title


def test_parse_sections_and_slugs():
    d = parse_daily_md(FIXTURE)
    assert [s.title for s in d.sections] == ["全国时政要闻", "申论精读"]
    assert [s.id for s in d.sections] == ["national", "essay"]


def test_parse_list_item():
    d = parse_daily_md(FIXTURE)
    item = d.sections[0].items[0]
    assert item.title.startswith("习近平")
    assert item.date == "08-12"
    assert item.source_url == "https://politics.people.com.cn/n1/2026/0812/c1024-40777729.html"
    assert item.quotes == []


def test_parse_sub_item_with_quotes():
    d = parse_daily_md(FIXTURE)
    item = d.sections[1].items[0]
    assert item.title.startswith("壹时评")
    assert item.date == "08-12"
    assert item.source_url == "http://opinion.people.com.cn/n1/2026/0812/c223228-40778377.html"
    assert len(item.quotes) == 1


def test_to_json_camel_case():
    d = parse_daily_md(FIXTURE)
    data = d.to_json()
    assert data["date"] == "2026-08-12"
    first_item = data["sections"][0]["items"][0]
    assert "sourceUrl" in first_item  # 键名 camelCase，不是 source_url
