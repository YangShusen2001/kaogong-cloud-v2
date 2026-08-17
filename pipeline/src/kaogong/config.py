# -*- coding: utf-8 -*-
"""站点配置：新闻源 + 内容筛选关键词 + 显示开关，存于 pipeline/config.json。

本地审核后台（review/server.py）读写它；管道（pipeline.py）读取它决定抓哪些源、
过滤哪些噪声。默认无 config.json 时回退到 sources.py 里的硬编码默认值。
"""
from __future__ import annotations

import json
from pathlib import Path

# pipeline/config.json（仓库根下 pipeline 目录）
CONFIG_PATH = Path(__file__).resolve().parents[2] / "config.json"


def load_site_config(path: Path | None = None) -> dict:
    """读取站点配置；不存在或损坏返回空 dict（调用方回退默认）。"""
    p = path or CONFIG_PATH
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_site_config(config: dict, path: Path | None = None) -> Path:
    """写回站点配置，返回路径。"""
    p = path or CONFIG_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return p
