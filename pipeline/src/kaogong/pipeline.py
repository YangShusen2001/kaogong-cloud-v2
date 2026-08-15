# -*- coding: utf-8 -*-
"""内容管道编排：抓取 → 组装 → 写 content/ JSON。

这是「抓取逻辑 A」的顶层：把所有源跑一遍，只保留目标日期，按槽位截断，
交给 build_digest 组装，最后写成前端消费的 content/{date}/digest.json。
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import httpx
from .build import build_digest
from .deepseek import load_config
from .models import Candidate
from .practice import generate_practice, practice_set_json
from .quality import artifact_semantic_errors, classify_artifact, load_artifact, schema_errors, volume_errors
from .sources import SOURCES, fetch_source

# 每槽位最多收录条数（与原项目 _CAP 一致）
CAPS = {
    "pol": 12, "gov": 8, "shi": 8, "qst": 6, "xh": 6, "rm": 6,
    "byt": 8, "gd": 10, "sc": 10, "js": 10, "gdp": 8, "nf": 8,
}
MAX_AI_FAILURES = 50


def fetch_candidates(
    target: dt.date, *, client: httpx.Client | None = None, report: dict | None = None,
) -> list[Candidate]:
    """跑全部源，只保留 target 当日的候选，按槽位截断。单源失败不影响其余。"""
    out: list[Candidate] = []
    for src in SOURCES:
        try:
            out.extend(fetch_source(src, client=client))
            if report is not None:
                report["sourcesOk"] = report.get("sourcesOk", 0) + 1
        except Exception as exc:
            if report is not None:
                report.setdefault("sourceErrors", []).append({
                    "source": src.name,
                    "error": f"source_fetch:{type(exc).__name__}",
                })
            continue
    out = [c for c in out if c.date == target]
    capped: list[Candidate] = []
    count: dict[str, int] = {}
    for c in out:
        n = count.get(c.slot, 0)
        if n >= CAPS.get(c.slot, 20):
            continue
        count[c.slot] = n + 1
        capped.append(c)
    return capped


def build_content(target: dt.date, content_dir: Path, *, client: httpx.Client | None = None) -> Path:
    """抓取 → 组装 → 写 content/{date}/digest.json，返回产物路径。"""
    report: dict = {"date": target.isoformat(), "sourcesOk": 0, "sourceErrors": []}
    candidates = fetch_candidates(target, client=client, report=report)
    report["candidates"] = len(candidates)
    digest = build_digest(candidates, target)
    out_dir = content_dir / target.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "digest.json"
    path.write_text(
        json.dumps(digest.to_json(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report_dir = content_dir / "_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"{target.isoformat()}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def clip_content(
    target: dt.date, content_dir: Path, *, client: httpx.Client | None = None,
    cfg: dict[str, str] | None = None,
) -> int:
    """为某天日报的条目剪藏原文，写 content/{date}/article-{id}.json。返回剪藏成功数。"""
    from .clip import clip_article
    from .article_ai import analyze_article

    digest_path = content_dir / target.isoformat() / "digest.json"
    if not digest_path.exists():
        return 0
    digest = json.loads(digest_path.read_text(encoding="utf-8"))
    n = 0
    report_path = content_dir / "_reports" / f"{target.isoformat()}.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {"date": target.isoformat()}
    report.update({
        "articles": 0, "aiOk": 0, "aiError": 0,
        "aiFailures": [], "locationErrors": 0,
    })
    ai_cfg = cfg if cfg is not None else load_config()
    for sec in digest.get("sections", []):
        for it in sec.get("items", []):
            url = it.get("sourceUrl", "")
            title = it.get("title", "")
            if not url:
                continue
            clip = clip_article(url, title, target.isoformat(), client=client)
            if clip.get("status") == "ok":
                clip = analyze_article(clip, ai_cfg)
                out = content_dir / target.isoformat() / f"article-{clip['id']}.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(clip, ensure_ascii=False, indent=2), encoding="utf-8")
                n += 1
                report["articles"] += 1
                if clip.get("aiStatus") == "ok":
                    report["aiOk"] += 1
                    report["locationErrors"] += clip.get("aiQuality", {}).get("locationErrors", 0)
                else:
                    report["aiError"] += 1
                    if len(report["aiFailures"]) < MAX_AI_FAILURES:
                        reason = str(clip.get("aiError", "ai_unknown:failure")).split(maxsplit=1)[0]
                        if not re.fullmatch(r"[a-z_]+:[a-zA-Z0-9_]+", reason):
                            reason = "ai_unknown:failure"
                        report["aiFailures"].append({
                            "articleId": str(clip["id"]),
                            "reason": reason,
                        })
    report_dir = content_dir / "_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"{target.isoformat()}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return n


def _digest_text(digest: dict) -> str:
    """把 digest.json 拍平成给 AI 出题用的纯文本：栏目 → 条目标题/摘要/金句。"""
    parts: list[str] = []
    for sec in digest.get("sections", []):
        sec_title = sec.get("title", "")
        if sec_title:
            parts.append(f"## {sec_title}")
        for it in sec.get("items", []):
            title = it.get("title", "")
            if title:
                parts.append(f"- {title}")
            summary = it.get("summary", "")
            if summary:
                parts.append(f"  摘要：{summary}")
            for q in it.get("quotes", []) or []:
                parts.append(f"  金句：{q}")
    return "\n".join(parts)


def practice_content(
    target: dt.date,
    content_dir: Path,
    *,
    cfg: dict | None = None,
    client: httpx.Client | None = None,
) -> Path | None:
    """为某天日报生成每日一练题集，写 content/{date}/practice.json。返回产物路径或 None。

    无 DeepSeek key / AI 输出不合格时返回 None，不抛错（保证日报与剪藏仍能产出）。
    """
    digest_path = content_dir / target.isoformat() / "digest.json"
    if not digest_path.exists():
        return None
    digest = json.loads(digest_path.read_text(encoding="utf-8"))
    text = _digest_text(digest)
    if not text.strip():
        return None
    cfg = cfg if cfg is not None else load_config()
    if not cfg.get("deepseek_api_key"):
        print("未配置 DEEPSEEK_API_KEY，跳过每日一练生成")
        return None
    questions = generate_practice(text, target.isoformat(), cfg)
    if not questions:
        print("每日一练生成失败（AI 输出不合格）")
        return None
    out_dir = content_dir / target.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "practice.json"
    payload = practice_set_json(target.isoformat(), questions, source=f"{target.isoformat()}.md")
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def quality_gate(target: dt.date, content_dir: Path) -> dict:
    """校验本次产物并写质量状态；failed 阻止自动发布，degraded 明确报告降级。"""
    report_path = content_dir / "_reports" / f"{target.isoformat()}.json"
    existing = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    report = {
        "date": target.isoformat(), "sourcesOk": 0, "sourceErrors": [],
        "candidates": 0, "articles": 0, "aiOk": 0, "aiError": 0,
        "aiFailures": [], "locationErrors": 0,
    } | existing
    schema_dir = content_dir / "schema"
    if not schema_dir.exists():
        schema_dir = Path(__file__).resolve().parents[3] / "content" / "schema"
    schemas = {
        "digest": json.loads((schema_dir / "digest.schema.json").read_text(encoding="utf-8")),
        "article": json.loads((schema_dir / "article.schema.json").read_text(encoding="utf-8")),
        "practice": json.loads((schema_dir / "practice.schema.json").read_text(encoding="utf-8")),
    }
    schema_error_list: list[dict[str, str]] = []
    semantic_error_list: list[dict[str, str]] = []
    out_dir = content_dir / target.isoformat()
    for path in sorted(out_dir.glob("*.json")) if out_dir.exists() else []:
        if classify_artifact(path) is None:
            continue
        try:
            artifact = load_artifact(path)
        except json.JSONDecodeError:
            schema_error_list.append({"file": path.name, "error": "invalid_json"})
            continue
        artifact_schema_errors = schema_errors(artifact, schemas[artifact.kind])
        schema_error_list.extend(artifact_schema_errors)
        if not artifact_schema_errors:
            semantic_error_list.extend(artifact_semantic_errors(artifact))
    volume_error_list = volume_errors(target, report_path.parent, report)
    report["schemaErrors"] = schema_error_list[:50]
    report["semanticErrors"] = semantic_error_list[:50]
    report["volumeErrors"] = volume_error_list[:50]
    if schema_error_list or semantic_error_list or volume_error_list or report.get("sourcesOk", 0) == 0 or report.get("candidates", 0) == 0:
        report["qualityStatus"] = "failed"
    elif report.get("sourceErrors") or report.get("aiError", 0) or report.get("locationErrors", 0):
        report["qualityStatus"] = "degraded"
    else:
        report["qualityStatus"] = "ok"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report
