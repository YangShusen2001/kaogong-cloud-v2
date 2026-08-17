# -*- coding: utf-8 -*-
"""审核 Agent 单测：judge_item 结构化判定、解析与降级。"""
import datetime as dt
import json

from kaogong.review_agent import _article_id, apply_decisions, judge_item, review_date


def _call(raw: str):
    def call(messages, cfg, max_tokens, temperature):
        return raw

    return call


def test_judge_item_parses_keep():
    item = {"title": "政策标题", "sourceUrl": "https://example.com/a", "summary": "摘要"}
    article = {
        "id": "abc123", "title": "政策标题", "source": "官媒", "paragraphs": ["正文"],
        "aiStatus": "ok", "aiSummary": "概括", "aiAnnotations": [],
    }
    cfg = {"deepseek_api_key": "k"}
    raw = json.dumps({"score": 88, "verdict": "keep", "reason": "相关且规范", "newTitle": "", "newSummary": ""}, ensure_ascii=False)

    out = judge_item(item, article, cfg, call=_call(raw))
    assert out["verdict"] == "keep"
    assert out["score"] == 88
    assert out["reason"] == "相关且规范"


def test_judge_item_rewrite_keeps_new_fields():
    item = {"title": "x", "sourceUrl": "https://example.com/a"}
    cfg = {"deepseek_api_key": "k"}
    raw = json.dumps({"score": 50, "verdict": "rewrite", "reason": "标题差", "newTitle": "新标题", "newSummary": ""}, ensure_ascii=False)

    out = judge_item(item, None, cfg, call=_call(raw))
    assert out["verdict"] == "rewrite"
    assert out["newTitle"] == "新标题"


def test_judge_item_degrades_to_needs_human_on_bad_output():
    item = {"title": "x", "sourceUrl": "https://example.com/a"}
    cfg = {"deepseek_api_key": "k"}

    out = judge_item(item, None, cfg, call=_call("not json"), attempts=2)
    assert out["verdict"] == "needs_human"


def test_judge_item_missing_key_degrades():
    item = {"title": "x", "sourceUrl": "https://example.com/a"}
    out = judge_item(item, None, {"deepseek_api_key": ""}, call=_call("{}"))
    assert out["verdict"] == "needs_human"


def test_article_id_matches_server_convention():
    assert _article_id("https://example.com/a") == _article_id("https://example.com/a")
    assert len(_article_id("https://example.com/a")) == 10


def test_review_date_empty_when_no_digest(tmp_path):
    out = review_date(dt.date(2026, 8, 15), tmp_path, {"deepseek_api_key": "k"})
    assert out == []


def _digest():
    return {
        "date": "2026-08-15", "title": "日报", "sections": [
            {"id": "national", "title": "全国", "items": [
                {"title": "旧标题", "date": "08-15", "sourceUrl": "https://example.com/a", "summary": "旧摘要"},
                {"title": "噪声", "date": "08-15", "sourceUrl": "https://example.com/b", "summary": ""},
            ]},
        ],
    }


def test_apply_decisions_rewrite_and_drop(tmp_path):
    day = tmp_path / "2026-08-15"
    day.mkdir()
    decisions = [
        {"articleId": "a", "title": "旧标题", "verdict": "rewrite", "newTitle": "新标题", "newSummary": "新摘要", "reason": "标题差"},
        {"articleId": "b", "title": "噪声", "verdict": "drop", "newTitle": "", "newSummary": "", "reason": "无关"},
    ]
    new_digest, changes = apply_decisions(_digest(), decisions, day)
    items = new_digest["sections"][0]["items"]
    assert items[0]["title"] == "新标题"
    assert items[0]["summary"] == "新摘要"
    assert len(items) == 1  # drop 移除了一条
    assert len(changes) == 2
    assert changes[0]["verdict"] == "rewrite"
    assert changes[1]["verdict"] == "drop"


def test_apply_decisions_syncs_article_title(tmp_path):
    day = tmp_path / "2026-08-15"
    day.mkdir()
    url = "https://example.com/a"
    article_id = _article_id(url)
    (day / f"article-{article_id}.json").write_text(
        json.dumps({"id": article_id, "title": "旧标题", "url": url, "paragraphs": ["正文"]}, ensure_ascii=False),
        encoding="utf-8",
    )
    digest = {
        "date": "2026-08-15", "title": "日报", "sections": [
            {"id": "national", "title": "全国", "items": [{"title": "旧标题", "date": "08-15", "sourceUrl": url, "summary": ""}]},
        ],
    }
    decisions = [{"articleId": article_id, "title": "旧标题", "verdict": "rewrite", "newTitle": "新标题", "newSummary": ""}]
    apply_decisions(digest, decisions, day)
    updated = json.loads((day / f"article-{article_id}.json").read_text(encoding="utf-8"))
    assert updated["title"] == "新标题"
