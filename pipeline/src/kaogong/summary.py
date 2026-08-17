# -*- coding: utf-8 -*-
"""今日速览：把当天 digest 概括成「一句话 + 关键词」，供首页横幅与海报长图。"""
from __future__ import annotations

import json
import re
from typing import Callable

ChatFn = Callable[..., str]


def build_summary_prompt() -> str:
    return (
        "你是时政日报编辑。用户会给你某一天的时政材料全文（含标题/摘要/金句/关键标注）。\n"
        "请输出今天最重要的时政要点速览：\n"
        "1. summary：一句话（不超过 60 字）概括今天最值得考生关注的内容；\n"
        "2. keywords：3~5 个关键词/主题（每个 2~8 字），如 防灾减灾、广东开渔、四川全会。\n"
        '只输出 JSON：{"summary":"...","keywords":["...","..."]}'
    )


def parse_summary(content: str) -> dict | None:
    """从 AI 返回文本抽出 summary + keywords；不合法返回 None。"""
    m = re.search(r"\{[\s\S]*\}", content or "")
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    summary = str(obj.get("summary") or "").strip()[:120]
    keywords = [str(k).strip()[:12] for k in (obj.get("keywords") or []) if str(k).strip()][:6]
    if not summary:
        return None
    return {"summary": summary, "keywords": keywords}


def generate_summary(digest_text: str, cfg: dict, *, chat_fn: ChatFn | None = None) -> dict | None:
    """调用 DeepSeek 生成今日速览；失败重试一次，仍失败返回 None。"""
    from .deepseek import chat as _deepseek_chat

    chat_fn = chat_fn or _deepseek_chat
    for _ in (1, 2):
        try:
            content = chat_fn(
                [
                    {"role": "system", "content": build_summary_prompt()},
                    {"role": "user", "content": digest_text[:8000]},
                ],
                cfg,
                max_tokens=300,
                temperature=0.5,
                timeout=120,
                extra={"response_format": {"type": "json_object"}},
            )
            parsed = parse_summary(content)
            if parsed:
                return parsed
        except Exception:
            continue
    return None
