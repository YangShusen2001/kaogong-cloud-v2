# -*- coding: utf-8 -*-
"""本地审核服务测试：北京时间日期、参数校验、补跑 AI 守卫、发布拦截。"""
import datetime as dt
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
import kaogong.review.server as server

UTC = dt.timezone.utc


@pytest.fixture()
def client() -> TestClient:
    return TestClient(server.app)


def test_beijing_today_crosses_utc_midnight():
    # UTC 16:00 08-16 = 北京 08-17 00:00（次日）
    assert server.beijing_today(dt.datetime(2026, 8, 16, 16, 0, tzinfo=UTC)) == dt.date(2026, 8, 17)
    # UTC 15:59 08-16 = 北京 08-16 23:59（当日）
    assert server.beijing_today(dt.datetime(2026, 8, 16, 15, 59, tzinfo=UTC)) == dt.date(2026, 8, 16)


def test_parse_target_rejects_invalid_date():
    with pytest.raises(HTTPException) as exc:
        server._parse_target("2026-13-99")
    assert exc.value.status_code == 400


def test_parse_target_defaults_to_beijing_today(monkeypatch):
    monkeypatch.setattr(server, "beijing_today", lambda: dt.date(2026, 8, 17))
    assert server._parse_target("") == dt.date(2026, 8, 17)


def test_reanalyze_default_cleans_without_ai_key(client, tmp_path, monkeypatch):
    # 默认补跑只清洗正文/重定位标注，不调用 AI，无 key 也允许
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(server, "CONTENT", tmp_path)
    day = tmp_path / "2026-08-15"
    day.mkdir()
    (day / "article-x.json").write_text(json.dumps({"id": "x", "status": "ok",
        "paragraphs": ["&emsp;干净正文。"]}), encoding="utf-8")
    reports = tmp_path / "_reports"
    reports.mkdir()
    (reports / "2026-08-15.json").write_text(json.dumps({
        "date": "2026-08-15", "articles": 1, "aiOk": 0, "aiError": 1,
    }), encoding="utf-8")
    response = client.post("/api/reanalyze", json={"date": "2026-08-15"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["rewritten"] >= 0


def test_reanalyze_force_requires_ai_key(client, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    response = client.post("/api/reanalyze", json={"date": "2026-08-15", "force": True})
    assert response.status_code == 400
    assert "DEEPSEEK_API_KEY" in response.json()["detail"]


def test_publish_blocked_by_latest_failed_report(client, tmp_path, monkeypatch):
    reports = tmp_path / "_reports"
    reports.mkdir(parents=True)
    (reports / "2026-08-16.json").write_text(json.dumps({
        "date": "2026-08-16", "qualityStatus": "failed",
        "candidates": 0, "articles": 0, "aiError": 0,
    }), encoding="utf-8")
    monkeypatch.setattr(server, "CONTENT", tmp_path)
    response = client.post("/api/publish")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["step"] == "质量门禁"
    assert "2026-08-16" in body["log"]


def test_publish_allowed_without_failed_report(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "CONTENT", tmp_path)
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct")
    monkeypatch.setattr(server, "_run", lambda cmd, cwd: (True, "fake build+deploy ok"))
    response = client.post("/api/publish")
    assert response.status_code == 200
    assert response.json()["started"] is True
    # 后台线程很快完成，轮询状态直到 done
    import time
    status = client.get("/api/publish/status").json()
    for _ in range(100):
        if status["done"]:
            break
        time.sleep(0.02)
        status = client.get("/api/publish/status").json()
    assert status["done"] is True
    assert status["ok"] is True
    assert "fake build+deploy ok" in status["log"]


def test_publish_blocked_without_cloudflare_credentials(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "CONTENT", tmp_path)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    response = client.post("/api/publish")
    body = response.json()
    assert body["ok"] is False
    assert body["step"] == "凭证检查"
    assert "CLOUDFLARE_API_TOKEN" in body["log"]


def test_fetch_reports_quality_status(client, tmp_path, monkeypatch):
    """fetch 端点走完整编排后返回质量摘要（不真抓网）。"""
    monkeypatch.setattr(server, "CONTENT", tmp_path)
    digest = tmp_path / "2026-08-15" / "digest.json"
    digest.parent.mkdir(parents=True)
    digest.write_text(json.dumps({"date": "2026-08-15", "title": "t", "sections": []}), encoding="utf-8")
    report_dir = tmp_path / "_reports"
    report_dir.mkdir(parents=True)
    (report_dir / "2026-08-15.json").write_text(json.dumps({
        "date": "2026-08-15", "qualityStatus": "degraded",
        "sourcesOk": 15, "sourceErrors": [], "candidates": 3, "articles": 2,
        "aiOk": 1, "aiError": 1, "aiFailures": [{"articleId": "a", "reason": "ai_config:missing_api_key"}],
        "locationErrors": 0,
    }), encoding="utf-8")
    monkeypatch.setattr(server, "build_content", lambda target, content_dir: digest)
    monkeypatch.setattr(server, "clip_content", lambda target, content_dir: 2)
    monkeypatch.setattr(server, "practice_content", lambda target, content_dir: None)
    monkeypatch.setattr(server, "quality_gate", lambda target, content_dir: {"qualityStatus": "degraded"})
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    response = client.post("/api/fetch", json={"date": "2026-08-15"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["clips"] == 2
    assert body["aiKeyConfigured"] is False
    assert body["quality"]["qualityStatus"] == "degraded"
    assert body["quality"]["aiError"] == 1
