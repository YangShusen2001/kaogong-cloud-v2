# -*- coding: utf-8 -*-
"""每日一练出题逻辑单测：target_count + parse_questions + generate_practice（注入 mock chat）。"""
import json

from kaogong.practice import generate_practice, parse_questions, target_count


def _q(i, **over):
    q = {"q": f"题干{i}", "options": ["A", "B", "C", "D"], "answer": 0, "analysis": "解析", "topic": "主题"}
    q.update(over)
    return q


def _content(items):
    return json.dumps({"questions": items}, ensure_ascii=False)


def test_target_count():
    assert target_count("") == 3
    assert target_count("x" * 240) == 3      # 240//120=2，抬到下限 3
    assert target_count("x" * 1200) == 10    # 1200//120=10
    assert target_count("x" * 10000) == 30   # 封顶 30


def test_parse_questions_valid():
    items = [_q(1), _q(2), _q(3)]
    qs = parse_questions(_content(items))
    assert len(qs) == 3
    assert qs[0]["id"] == "q1"
    assert qs[0]["answer"] == 0


def test_parse_questions_requires_at_least_3():
    assert parse_questions(_content([_q(1), _q(2)])) == []


def test_parse_questions_skips_invalid_answer():
    items = [_q(1), _q(2), _q(3, answer=5), _q(4)]  # 第 3 题 answer 非法，跳过，仍剩 3 题
    qs = parse_questions(_content(items))
    assert len(qs) == 3
    assert all(q["answer"] == 0 for q in qs)


def test_parse_questions_skips_boolean_answer():
    items = [_q(1), _q(2), _q(3, answer=True), _q(4)]
    qs = parse_questions(_content(items))
    assert len(qs) == 3


def test_parse_questions_skips_bad_options():
    items = [_q(1), _q(2), _q(3, options=["A", "B", "C"]), _q(4)]  # 第 3 题只有 3 选项
    qs = parse_questions(_content(items))
    assert len(qs) == 3


def test_generate_practice_retries_then_succeeds():
    calls = []

    def chat_fn(messages, cfg, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            return "这不是 JSON"
        return _content([_q(1), _q(2), _q(3)])

    qs = generate_practice("x" * 1200, "2026-08-12", {"deepseek_api_key": "k"}, chat_fn=chat_fn)
    assert len(qs) == 3
    assert len(calls) == 2  # 第一次不合格，重试成功


def test_generate_practice_gives_up_after_two():
    qs = generate_practice(
        "x" * 1200, "2026-08-12", {"deepseek_api_key": "k"},
        chat_fn=lambda messages, cfg, **kw: "还是不是 JSON",
    )
    assert qs == []
