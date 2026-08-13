# -*- coding: utf-8 -*-
"""跨源近似去重（移植自原 site_builder/digest_md.py 的纯函数部分）。

用途：不同新闻源（人民网/新华网/政府网…）常转载同一事件，标题略有差异。
通过「标题归一化 + 连续公共子串」判定近似重复，避免日报里同一条新闻出现多次。
"""
from __future__ import annotations

import re

from .http import IndexedLink

# 常见来源前缀，归一化时去掉，避免「人民网：xxx」与「xxx」被当成两条
SOURCE_PREFIXES = [
    "人民网", "新华网", "新华社", "人民日报", "半月谈", "求是网",
    "南方网", "南方日报", "广州日报", "大洋网", "中国政府网", "粤学习",
]

_FULLWIDTH_RE = re.compile(r"[！-～]")
_PUNCT_RE = re.compile(r"[，。！？、；：,.!?;:<>\"'“”‘’【】\[\]（）()\-—_|/\\]")


def _fullwidth_to_halfwidth(ch: str) -> str:
    return chr(ord(ch) - 0xFEE0)


def normalize_title(t: str) -> str:
    """标题归一化：去来源前缀、全角转半角、去标点与空白，用于近似去重。"""
    t = str(t or "").replace("\u3000", " ").strip()
    t = _FULLWIDTH_RE.sub(lambda m: _fullwidth_to_halfwidth(m.group(0)), t)
    for p in SOURCE_PREFIXES:
        if t.startswith(p):
            t = t[len(p):]
    t = t.strip(" ：:|-—（）()[]【】")
    t = _PUNCT_RE.sub("", t)
    return re.sub(r"\s+", "", t)


def is_same_event(a: str, b: str) -> bool:
    """归一化标题的近似事件判定：共享任意连续 ≥8 字（4 个连续双字词）视为同事件。

    阈值保守（宁多勿漏）：两篇不同文章恰好连续 8 字相同的概率极低。
    """
    if not a or not b:
        return False
    if a == b:
        return True
    bigrams = {b[i:i + 2] for i in range(len(b) - 1)}
    run = 0
    for i in range(len(a) - 1):
        if a[i:i + 2] in bigrams:
            run += 1
            if run >= 4:  # 连续 4 个双字词 = 8 字重合
                return True
        else:
            run = 0
    return False


def dedupe_items(items: list[IndexedLink]) -> list[IndexedLink]:
    """按 URL 与归一化标题去重；来源优先级 = 调用方传入顺序（先到先得）。"""
    seen_url: set[str] = set()
    seen_title: list[str] = []
    out: list[IndexedLink] = []
    for it in items:
        if it.url in seen_url:
            continue
        norm = normalize_title(it.title)
        if norm and any(is_same_event(norm, s) for s in seen_title):
            continue
        seen_url.add(it.url)
        if norm:
            seen_title.append(norm)
        out.append(it)
    return out
