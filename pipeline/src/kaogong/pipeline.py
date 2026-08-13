# -*- coding: utf-8 -*-
"""内容管道编排：抓取 → 组装 → 写 content/ JSON。

这是「抓取逻辑 A」的顶层：把所有源跑一遍，只保留目标日期，按槽位截断，
交给 build_digest 组装，最后写成前端消费的 content/{date}/digest.json。
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import httpx

from .build import build_digest
from .models import Candidate
from .sources import SOURCES, fetch_source

# 每槽位最多收录条数（与原项目 _CAP 一致）
CAPS = {
    "pol": 12, "gov": 8, "shi": 8, "qst": 6, "xh": 6, "rm": 6,
    "byt": 8, "gd": 10, "sc": 10, "js": 10, "gdp": 8, "nf": 8,
}


def fetch_candidates(target: dt.date, *, client: httpx.Client | None = None) -> list[Candidate]:
    """跑全部源，只保留 target 当日的候选，按槽位截断。单源失败不影响其余。"""
    out: list[Candidate] = []
    for src in SOURCES:
        try:
            out.extend(fetch_source(src, client=client))
        except Exception:
            continue
    out = [c for c in out if c.date == target]
    capped: list[Candidate] = []
    count: dict[str, int] = {}
    for c in out:
        n = count.get(c.slot, 0)
        if n >= CAPS.get(c.slot, 20):
            continue
        count[c.slot] = n + 1
        capped.append(c)
    return capped


def build_content(target: dt.date, content_dir: Path, *, client: httpx.Client | None = None) -> Path:
    """抓取 → 组装 → 写 content/{date}/digest.json，返回产物路径。"""
    digest = build_digest(fetch_candidates(target, client=client), target)
    out_dir = content_dir / target.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "digest.json"
    path.write_text(
        json.dumps(digest.to_json(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def clip_content(target: dt.date, content_dir: Path, *, client: httpx.Client | None = None) -> int:
    """为某天日报的条目剪藏原文，写 content/{date}/article-{id}.json。返回剪藏成功数。"""
    from .clip import clip_article

    digest_path = content_dir / target.isoformat() / "digest.json"
    if not digest_path.exists():
        return 0
    digest = json.loads(digest_path.read_text(encoding="utf-8"))
    n = 0
    for sec in digest.get("sections", []):
        for it in sec.get("items", []):
            url = it.get("sourceUrl", "")
            title = it.get("title", "")
            if not url:
                continue
            clip = clip_article(url, title, target.isoformat(), client=client)
            if clip.get("status") == "ok":
                out = content_dir / target.isoformat() / f"article-{clip['id']}.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(clip, ensure_ascii=False, indent=2), encoding="utf-8")
                n += 1
    return n
