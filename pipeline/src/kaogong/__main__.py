# -*- coding: utf-8 -*-
"""CLI 入口：python -m kaogong [date] [--content-dir DIR]。"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

from .pipeline import build_content


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="考公日报内容管道：抓取官方源 → 产出 content/ JSON")
    p.add_argument("date", nargs="?", default=None, help="目标日期 YYYY-MM-DD，默认今天")
    p.add_argument("--content-dir", default=None, help="content 目录，默认仓库根 content/")
    args = p.parse_args(argv)
    target = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    content_dir = (
        Path(args.content_dir)
        if args.content_dir
        else Path(__file__).resolve().parents[3] / "content"
    )
    path = build_content(target, content_dir)
    print(f"已生成：{path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
