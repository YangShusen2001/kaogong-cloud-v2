# -*- coding: utf-8 -*-
"""不重抓原文、只补跑 AI 标注。"""
import datetime as dt
import json

from kaogong.reanalyze import reanalyze_content


def _write_article(day, article_id, ai_status=None, extra=None):
    payload = {
        "id": article_id,
        "date": day.name,
        "title": "标题",
        "source": "人民网",
        "url": f"https://example.com/{article_id}",
        "pubDate": "",
        "fetchedAt": "2026-08-13T00:00:00+00:00",
        "status": "ok",
        "paragraphs": ["高质量发展是全面建设社会主义现代化国家的首要任务。"],
        "keySentences": [],
    }
    if ai_status is not None:
        payload["aiStatus"] = ai_status
    if extra:
        payload.update(extra)
    path = day / f"article-{article_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_reanalyze_content_skips_ok_and_rewrites_missing_or_error(tmp_path, monkeypatch):
    target = dt.date(2026, 8, 13)
    day = tmp_path / target.isoformat()
    day.mkdir()
    _write_article(day, "ok1", "ok", extra={"aiAnnotations": [{"id": "keep"}]})
    missing = _write_article(day, "miss1")
    failed = _write_article(day, "err1", "error", extra={"aiError": "ai_config:missing_api_key"})

    seen: list[str] = []

    def fake_analyze(article, cfg):
        seen.append(article["id"])
        return article | {"aiStatus": "ok", "aiAnnotations": [{"id": f"ai-{article['id']}"}]}

    import kaogong.reanalyze as reanalyze_mod
    monkeypatch.setattr(reanalyze_mod, "analyze_article", fake_analyze)

    count = reanalyze_content(target, tmp_path, cfg={"deepseek_api_key": "k"})

    # ok1 缺 sourceTextHash（ok 态必需字段），normalize 会补齐并写入，但不重新调用 AI
    assert count == 3
    assert seen == ["err1", "miss1"]
    ok1 = json.loads((day / "article-ok1.json").read_text(encoding="utf-8"))
    assert ok1["aiAnnotations"] == [{"id": "keep"}]
    assert ok1["sourceTextHash"]
    assert json.loads(missing.read_text(encoding="utf-8"))["aiStatus"] == "ok"
    assert json.loads(failed.read_text(encoding="utf-8"))["aiAnnotations"] == [{"id": "ai-err1"}]


def test_reanalyze_cleans_entities_and_relocates_annotations(tmp_path, monkeypatch):
    """已成功的文章带字面实体：normalize 清洗正文并重定位偏移，不调用 AI。"""
    target = dt.date(2026, 8, 13)
    day = tmp_path / target.isoformat()
    day.mkdir()
    # 标注偏移基于带实体的旧文本（&emsp;&emsp; = 13 个字符），清洗后段落变短
    raw_para = "&emsp;&emsp;今天进行二十届中央政治局第二十五次集体学习。"
    article = {
        "id": "ent1", "date": day.name, "title": "标题", "source": "求是网",
        "url": "https://example.com/ent1", "pubDate": "", "fetchedAt": "2026-08-13T00:00:00+00:00",
        "status": "ok", "paragraphs": [raw_para], "keySentences": [],
        "aiStatus": "ok", "aiSummary": "摘要" * 15,
        "aiAnnotations": [{
            "id": "ai-0", "paragraphIndex": 0, "start": 13, "end": 17,
            "text": "今天进行", "type": "viewpoint",
        }],
        "aiModel": "deepseek-chat", "aiPromptVersion": "article-analysis-v1",
        "aiGeneratedAt": "2026-08-13T00:00:00+00:00",
        "sourceTextHash": "a" * 64, "aiQuality": {"locationErrors": 0},
        # 旧失败残留（ok 态不允许出现）
        "aiError": "ai_config:missing_api_key",
    }
    (day / "article-ent1.json").write_text(json.dumps(article, ensure_ascii=False), encoding="utf-8")

    import kaogong.reanalyze as reanalyze_mod
    called = []
    monkeypatch.setattr(reanalyze_mod, "analyze_article", lambda *a, **k: called.append(1) or {})

    count = reanalyze_content(target, tmp_path, cfg={"deepseek_api_key": "k"})

    assert called == []
    assert count == 1
    out = json.loads((day / "article-ent1.json").read_text(encoding="utf-8"))
    assert out["paragraphs"][0] == "今天进行二十届中央政治局第二十五次集体学习。"
    assert "aiError" not in out
    assert out["aiAnnotations"][0]["start"] == 0
    assert out["aiAnnotations"][0]["end"] == 4


def test_reanalyze_content_returns_zero_when_day_missing(tmp_path):
    assert reanalyze_content(dt.date(2026, 8, 13), tmp_path, cfg={"deepseek_api_key": "k"}) == 0
