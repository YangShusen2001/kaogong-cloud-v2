# -*- coding: utf-8 -*-
"""CLI 入口：python -m kaogong [date] [--content-dir DIR]。"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from .pipeline import build_content, clip_content, practice_content, quality_gate


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
    n_clips = clip_content(target, content_dir)
    practice_path = practice_content(target, content_dir)
    quality = quality_gate(target, content_dir)
    print(json.dumps({
        "event": "pipeline.complete",
        "date": target.isoformat(),
        "digest": str(path),
        "articles": n_clips,
        "practice": str(practice_path) if practice_path else None,
        "qualityStatus": quality["qualityStatus"],
    }, ensure_ascii=False))
    return 1 if quality["qualityStatus"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
