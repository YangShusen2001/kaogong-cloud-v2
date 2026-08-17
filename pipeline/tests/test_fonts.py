# -*- coding: utf-8 -*-
"""字体管理单测：safe_stem / config 读写 / 子集化。"""
from pathlib import Path

from kaogong.fonts import load_config, safe_stem, save_config, subset_to_woff2

WEB_FONTS = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "fonts"


def test_safe_stem_normalizes():
    assert safe_stem("HYXiaoYaoYou J-2.ttf") == "HYXiaoYaoYou_J-2"
    assert safe_stem("   ") == "font"


def test_config_round_trip(tmp_path):
    p = tmp_path / "font-config.json"
    assert load_config(p) == {"logo": None, "nav": None}
    save_config(p, {"logo": "a.woff2", "nav": None})
    assert load_config(p) == {"logo": "a.woff2", "nav": None}


def test_subset_to_woff2(tmp_path):
    src = WEB_FONTS / "HYXiaoYaoYouJ-logo.woff2"
    if not src.exists():
        return  # 环境里没有源字体则跳过
    dst = tmp_path / "out.woff2"
    subset_to_woff2(src, "每日", dst)
    assert dst.exists() and dst.stat().st_size > 0
