# -*- coding: utf-8 -*-
"""今日速览单测：parse_summary + generate_summary（注入 mock chat）。"""
import json

from kaogong.summary import generate_summary, parse_summary


def test_parse_summary_valid():
    content = json.dumps(
        {"summary": "今天重点关注防灾减灾与地方全会。", "keywords": ["防灾减灾", "广东开渔"]},
        ensure_ascii=False,
    )
    out = parse_summary(content)
    assert out["summary"].startswith("今天重点")
    assert out["keywords"] == ["防灾减灾", "广东开渔"]


def test_parse_summary_invalid_returns_none():
    assert parse_summary("这不是 JSON") is None


def test_generate_summary_retries_then_succeeds():
    calls = []

    def chat_fn(messages, cfg, **kw):
        calls.append(1)
        if len(calls) == 1:
            return "坏输出"
        return json.dumps({"summary": "今日要点", "keywords": ["要点"]}, ensure_ascii=False)

    out = generate_summary("材料", {"deepseek_api_key": "k"}, chat_fn=chat_fn)
    assert out["summary"] == "今日要点"
    assert len(calls) == 2
