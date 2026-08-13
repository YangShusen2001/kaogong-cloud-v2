# -*- coding: utf-8 -*-
"""DeepSeek 客户端单测（httpx.MockTransport，不真实联网）。"""
import json

import httpx
import pytest

from kaogong.deepseek import DEFAULT_MODEL, chat, load_config


def test_load_config_env_priority(monkeypatch, tmp_path):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "envkey")
    assert load_config(tmp_path / "missing.json") == {"deepseek_api_key": "envkey"}


def test_load_config_reads_file(monkeypatch, tmp_path):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    p = tmp_path / "config.json"
    p.write_text('{"deepseek_api_key": "filekey"}', encoding="utf-8")
    assert load_config(p) == {"deepseek_api_key": "filekey"}


def test_chat_requires_key():
    with pytest.raises(RuntimeError):
        chat([{"role": "user", "content": "hi"}], {})


def test_chat_returns_content():
    def handler(request):
        assert request.url.path == "/chat/completions"
        body = json.loads(request.content)
        assert body["model"] == DEFAULT_MODEL
        assert body["messages"][0]["content"] == "hi"
        return httpx.Response(200, json={"choices": [{"message": {"content": "  回答  "}}]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        out = chat([{"role": "user", "content": "hi"}], {"deepseek_api_key": "k"}, client=client)
    assert out == "回答"


def test_chat_passes_extra_fields():
    def handler(request):
        body = json.loads(request.content)
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        chat(
            [{"role": "user", "content": "hi"}],
            {"deepseek_api_key": "k"},
            extra={"response_format": {"type": "json_object"}},
            client=client,
        )
