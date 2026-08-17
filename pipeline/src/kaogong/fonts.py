# -*- coding: utf-8 -*-
"""字体管理：上传 TTF → fonttools 子集化 → 存 WOFF2 + 写 font-config.json。

供本地审核服务（review/server.py）调用；前端（Astro）构建时读 font-config.json
生成 @font-face 与 CSS 变量。子集化只保留 logo/导航用字，避免整包 24MB 字体进站。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fontTools import subset

# 子集化用字：logo + 导航
LOGO_TEXT = "每日时政"
NAV_TEXT = "首页搜索收藏每日一练登录退出"


def safe_stem(name: str) -> str:
    """把上传文件名规范成安全前缀（去扩展名，只保留字母数字下划线连字符）。"""
    stem = Path(name or "").stem
    stem = re.sub(r"[^0-9A-Za-z_-]", "_", stem)
    return stem.strip("_") or "font"


def subset_to_woff2(src: Path, text: str, dst: Path) -> Path:
    """子集化 src 字体到 text 这些字符，存为 WOFF2，返回目标路径。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    options = subset.Options()
    options.flavor = "woff2"
    font = None
    try:
        font = subset.load_font(str(src), options)
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=text)
        subsetter.subset(font)
        subset.save_font(font, str(dst), options)
    finally:
        # 关闭字体释放文件句柄，避免 Windows 上后续删除源文件失败
        if font is not None:
            font.close()
    return dst


def load_config(path: Path) -> dict:
    """读取 font-config.json；不存在或损坏返回默认（都用系统字体）。"""
    if not path.exists():
        return {"logo": None, "nav": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"logo": None, "nav": None}
    return {
        "logo": data.get("logo") or None,
        "nav": data.get("nav") or None,
    }


def save_config(path: Path, config: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
