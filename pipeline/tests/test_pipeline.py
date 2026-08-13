# -*- coding: utf-8 -*-
"""管道编排单测：fetch_candidates / build_content 端到端（mock 全部网络）。"""
import datetime as dt
import json
from pathlib import Path

import httpx
import jsonschema

from kaogong.pipeline import build_content

_SCHEMA = (
    Path(__file__).resolve().parents[2] / "content" / "schema" / "digest.schema.json"
)


def _validate(data: dict):
    jsonschema.validate(data, json.loads(_SCHEMA.read_text(encoding="utf-8")))


def test_build_content_writes_valid_empty_digest(tmp_path):
    """所有源失败时仍产出结构合法（空 sections）的日报。"""

    def handler(request):
        return httpx.Response(500, text="")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        path = build_content(dt.date(2026, 8, 12), tmp_path, client=client)
    assert path.name == "digest.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["date"] == "2026-08-12"
    assert data["sections"] == []
    _validate(data)


def test_build_content_end_to_end(tmp_path):
    """gov 源产出候选 → 归入 national 栏目 → 写合法 JSON。"""

    def handler(request):
        if "content_" in request.url.path:
            return httpx.Response(200, text='<div>发布日期：2026-08-12 08:00</div>')
        return httpx.Response(
            200, text='<a href="/zhengce/content/202608/content_1.html">政策标题</a>'
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        path = build_content(dt.date(2026, 8, 12), tmp_path, client=client)
    data = json.loads(path.read_text(encoding="utf-8"))
    national = next(s for s in data["sections"] if s["id"] == "national")
    assert national["items"][0]["title"] == "政策标题"
    _validate(data)
