# -*- coding: utf-8 -*-
"""文章 AI 概括与只读标注：模型判断内容，程序负责定位和质量校验。"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypedDict

from .deepseek import DEFAULT_MODEL, chat

PROMPT_VERSION = "article-analysis-v1"
ALLOWED_TYPES = {"viewpoint", "exam_point", "term"}
ANNOTATION_MAXIMA = {"viewpoint": 5, "exam_point": 8, "term": 5}


class RawAnnotation(TypedDict, total=False):
    paragraphIndex: int
    text: str
    type: str
    explanation: str


class ArticleAiPayload(TypedDict):
    summary: str
    annotations: list[RawAnnotation]


@dataclass(frozen=True, slots=True)
class ArticleAiError(Exception):
    code: str

    def __str__(self) -> str:
        return self.code


def source_text_hash(paragraphs: list[str]) -> str:
    return hashlib.sha256("\n".join(p.strip() for p in paragraphs).encode("utf-8")).hexdigest()


def _json_object(raw: str) -> ArticleAiPayload:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ArticleAiError("ai_parse:json_object_missing")
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ArticleAiError("ai_parse:invalid_json") from exc
    if not isinstance(value, dict):
        raise ArticleAiError("ai_schema:root_not_object")
    summary = value.get("summary")
    annotations = value.get("annotations")
    if not isinstance(summary, str):
        raise ArticleAiError("ai_schema:summary_not_string")
    if not isinstance(annotations, list):
        raise ArticleAiError("ai_schema:annotations_not_array")
    parsed_annotations: list[RawAnnotation] = []
    for annotation in annotations:
        if not isinstance(annotation, dict):
            raise ArticleAiError("ai_schema:annotation_not_object")
        paragraph_index = annotation.get("paragraphIndex")
        snippet = annotation.get("text")
        kind = annotation.get("type")
        explanation = annotation.get("explanation")
        if not isinstance(paragraph_index, int):
            raise ArticleAiError("ai_schema:paragraph_index_not_integer")
        if not isinstance(snippet, str) or not isinstance(kind, str):
            raise ArticleAiError("ai_schema:annotation_field_not_string")
        if kind not in ALLOWED_TYPES:
            raise ArticleAiError("ai_schema:annotation_type_invalid")
        parsed: RawAnnotation = {
            "paragraphIndex": paragraph_index,
            "text": snippet,
            "type": kind,
        }
        if explanation is not None:
            if not isinstance(explanation, str):
                raise ArticleAiError("ai_schema:explanation_not_string")
            parsed["explanation"] = explanation
        parsed_annotations.append(parsed)
    return {"summary": summary, "annotations": parsed_annotations}


def _locate(paragraph: str, snippet: str) -> tuple[int, int]:
    start = paragraph.find(snippet)
    if start < 0:
        raise ValueError("标注片段无法在指定段落定位")
    if paragraph.find(snippet, start + 1) >= 0:
        raise ValueError("标注片段在指定段落中不唯一")
    # 浏览器 Range 使用 UTF-16 code unit；Python 默认索引是 Unicode code point。
    utf16_start = len(paragraph[:start].encode("utf-16-le")) // 2
    utf16_end = utf16_start + len(snippet.encode("utf-16-le")) // 2
    return utf16_start, utf16_end


def _utf16_slice(text: str, start: int, end: int) -> str:
    raw = text.encode("utf-16-le")
    return raw[start * 2:end * 2].decode("utf-16-le")


def validate_article_ai(article: dict) -> list[str]:
    """返回语义质量错误；JSON Schema 之外的跨字段规则在这里校验。"""
    errors: list[str] = []
    paragraphs = article.get("paragraphs") or []
    if article.get("sourceTextHash") != source_text_hash(paragraphs):
        errors.append("source_hash_mismatch")
    seen: set[str] = set()
    counts = {kind: 0 for kind in ALLOWED_TYPES}
    for annotation in article.get("aiAnnotations") or []:
        aid = annotation.get("id", "")
        if not aid:
            errors.append("annotation_id_invalid")
        elif aid in seen:
            errors.append("annotation_id_duplicate")
        seen.add(aid)
        index = annotation.get("paragraphIndex", -1)
        start, end = annotation.get("start", -1), annotation.get("end", -1)
        if not isinstance(index, int) or not 0 <= index < len(paragraphs):
            errors.append("paragraph_out_of_range")
            continue
        utf16_length = len(paragraphs[index].encode("utf-16-le")) // 2
        if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= utf16_length:
            errors.append("offset_invalid")
            continue
        try:
            selected_text = _utf16_slice(paragraphs[index], start, end)
        except UnicodeDecodeError:
            errors.append("offset_invalid")
            continue
        if selected_text != annotation.get("text"):
            errors.append("annotation_text_mismatch")
        if annotation.get("type") not in ALLOWED_TYPES:
            errors.append("annotation_type_invalid")
        else:
            counts[annotation["type"]] += 1
        explanation = annotation.get("explanation")
        if explanation and annotation.get("type") != "term":
            errors.append("explanation_type_invalid")
    for kind, maximum in ANNOTATION_MAXIMA.items():
        if counts[kind] > maximum:
            errors.append(f"annotation_count_{kind}")
    return errors


def _messages(title: str, paragraphs: list[str], *, rewrite: bool = False) -> list[dict[str, str]]:
    article = "\n".join(f"[{i}] {p}" for i, p in enumerate(paragraphs))
    length = "将 summary 重写为 80-120 个中文字符。" if rewrite else "summary 必须为 80-120 个中文字符。"
    return [
        {"role": "system", "content": (
            "你是公务员考试时政内容编辑。只返回 JSON，不得返回 Markdown/HTML。"
            "不得补充原文没有的事实。annotations 每项只返回 paragraphIndex、text、type、explanation；"
            "text 必须是对应段落中的连续原文且在该段唯一。type 只能是 viewpoint、exam_point、term。"
            "仅 term 可有 explanation，释义 30-80 个中文字符。观点 2-5 处、考点 3-8 处、术语 1-5 处。"
        )},
        {"role": "user", "content": (
            f"{length}\n输出形状：{{\"summary\":\"...\",\"annotations\":[{{\"paragraphIndex\":0,"
            "\"text\":\"原文片段\",\"type\":\"viewpoint\"}]}}\n"
            f"标题：{title}\n原文：\n{article}"
        )},
    ]


def analyze_article(
    article: dict,
    cfg: dict[str, str],
    *,
    call: Callable[..., str] = chat,
    attempts: int = 2,
) -> dict:
    """返回带 AI 字段的新文章；任何失败均降级为 error，不修改原文。"""
    result = dict(article)
    paragraphs = list(article.get("paragraphs") or [])
    model = cfg.get("deepseek_model") or DEFAULT_MODEL
    generated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    base = {
        "aiModel": model,
        "aiPromptVersion": PROMPT_VERSION,
        "aiGeneratedAt": generated,
        "sourceTextHash": source_text_hash(paragraphs),
    }
    try:
        if not cfg.get("deepseek_api_key"):
            raise ArticleAiError("ai_config:missing_api_key")
        payload: ArticleAiPayload | None = None
        for attempt in range(attempts):
            payload = _json_object(call(
                _messages(str(article.get("title", "")), paragraphs, rewrite=attempt > 0),
                cfg, max_tokens=1800, temperature=0.2,
            ))
            summary = str(payload.get("summary", "")).strip()
            if 80 <= len(summary) <= 120:
                break
        if payload is None:
            raise ArticleAiError("ai_provider:no_output")
        summary = payload["summary"].strip()
        if not 60 <= len(summary) <= 150:
            raise ArticleAiError("ai_semantic:summary_length")
        annotations: list[dict] = []
        location_errors = 0
        for i, raw in enumerate(payload["annotations"]):
            try:
                index = int(raw["paragraphIndex"])
                snippet, kind = str(raw["text"]).strip(), str(raw["type"])
                if kind not in ALLOWED_TYPES or not 0 <= index < len(paragraphs) or not snippet:
                    raise ValueError("标注字段非法")
                start, end = _locate(paragraphs[index], snippet)
                annotation = {
                    "id": f"ai-{index}-{start}-{end}-{kind}", "paragraphIndex": index,
                    "start": start, "end": end, "text": snippet, "type": kind,
                }
                explanation = str(raw.get("explanation", "")).strip()
                if kind == "term" and 30 <= len(explanation) <= 80:
                    annotation["explanation"] = explanation
                annotations.append(annotation)
            except (KeyError, TypeError, ValueError):
                location_errors += 1
        result.update(base | {
            "aiStatus": "ok", "aiSummary": summary, "aiAnnotations": annotations,
            "aiQuality": {"locationErrors": location_errors},
        })
        errors = validate_article_ai(result)
        if errors:
            raise ArticleAiError(f"ai_semantic:{errors[0]}")
        return result
    except ArticleAiError as exc:
        reason = str(exc)
    except Exception:
        reason = "ai_provider:request_failed"
    result.update(base | {
        "aiStatus": "error", "aiAnnotations": [], "aiError": reason,
    })
    result.pop("aiSummary", None)
    result.pop("aiQuality", None)
    return result
