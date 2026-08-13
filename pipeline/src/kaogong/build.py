# -*- coding: utf-8 -*-
"""候选 → DailyDigest 组装（替代原 build_md 的拼 markdown 部分）。

纯函数、无 IO：只把去重后的候选按「栏目槽位」分组，产出结构化 DailyDigest。
金句/正文摘要的抓取属 IO，放在单独的「富化」阶段，不混进这里。
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .dedupe import dedupe_items
from .http import IndexedLink
from .models import Candidate, DailyDigest, DigestItem, DigestSection

WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

# 槽位 → 人读来源名（与原项目 SLOT_SOURCE 一致）
SLOT_SOURCE = {
    "pol": "人民网时政",
    "gov": "中国政府网政策",
    "shi": "人民网时评",
    "qst": "求是网",
    "xh": "新华时评",
    "rm": "人民日报评论",
    "byt": "半月谈今日谈",
    "gd": "广东要闻",
    "sc": "四川要闻",
    "js": "江苏要闻",
    "gdp": "广东政策",
    "nf": "南方时评",
}

# 地区栏目：(槽位, section_id, 栏目标题)
REGION_SECTIONS = (
    ("gd", "guangdong", "广东要闻动态"),
    ("sc", "sichuan", "四川要闻动态"),
    ("js", "jiangsu", "江苏要闻动态"),
)


def _to_item(c: Candidate) -> DigestItem:
    return DigestItem(title=c.title, date=c.date.strftime("%m-%d"), source_url=c.url, summary=c.summary)


def _dedupe(candidates: list[Candidate]) -> list[Candidate]:
    """按 URL + 归一化标题近似去重；来源优先级 = 传入顺序（先到先得）。"""
    links = [IndexedLink(c.date, c.title, c.url) for c in candidates]
    kept_urls = [l.url for l in dedupe_items(links)]
    by_url: dict[str, Candidate] = {}
    for c in candidates:
        by_url.setdefault(c.url, c)
    return [by_url[u] for u in kept_urls]


def build_digest(candidates: list[Candidate], date: dt.date) -> DailyDigest:
    """把候选按栏目槽位分组，产出结构化日报。"""
    by_slot: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_slot[c.slot].append(c)

    sections: list[DigestSection] = []

    # 全国时政要闻 = 人民网时政 + 中国政府网政策（合并近似去重）
    national = _dedupe(by_slot.get("pol", []) + by_slot.get("gov", []))
    if national:
        sections.append(DigestSection("national", "全国时政要闻", [_to_item(c) for c in national]))

    # 申论精读 = 人民网时评 + 求是网 + 新华时评 + 人民日报评论（按 url 去重）
    essay: list[Candidate] = []
    seen: set[str] = set()
    for slot in ("shi", "qst", "xh", "rm"):
        for c in by_slot.get(slot, []):
            if c.url not in seen:
                seen.add(c.url)
                essay.append(c)
    if essay:
        sections.append(DigestSection("essay", "申论精读", [_to_item(c) for c in essay]))

    # 地区要闻动态（无内容地区当日省略）
    for slot, sid, title in REGION_SECTIONS:
        items = by_slot.get(slot, [])
        if items:
            sections.append(DigestSection(sid, title, [_to_item(c) for c in items]))

    # 广东政策解读
    gdp = by_slot.get("gdp", [])
    if gdp:
        sections.append(DigestSection("guangdong-policy", "广东政策解读", [_to_item(c) for c in gdp]))

    # 今日谈（半月谈，最多 2 条）
    byt = by_slot.get("byt", [])[:2]
    if byt:
        sections.append(DigestSection("today-talk", "今日谈（半月谈·申论素材）", [_to_item(c) for c in byt]))

    # 南方时评
    nf = by_slot.get("nf", [])
    if nf:
        sections.append(DigestSection("south-review", "南方时评（南方网·广东申论素材）", [_to_item(c) for c in nf]))

    return DailyDigest(
        date=date.isoformat(),
        title=f"每日日报 · {date:%Y-%m-%d}（{WEEKDAYS[date.weekday()]}）",
        sections=sections,
    )
