# -*- coding: utf-8 -*-
"""契约测试：content/ 下的样例内容必须通过 JSON Schema 校验。

这是「管道 ↔ 前端」跨语言边界的机器校验——谁破坏了契约，这里立刻红。
"""
import json
from pathlib import Path

import jsonschema

CONTENT = Path(__file__).resolve().parents[2] / "content"
SCHEMAS = CONTENT / "schema"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_sample_content_matches_schema():
    digest_schema = _load(SCHEMAS / "digest.schema.json")
    article_schema = _load(SCHEMAS / "article.schema.json")
    practice_schema = _load(SCHEMAS / "practice.schema.json")
    samples = list((CONTENT / "2026-08-12").glob("*.json"))
    assert samples, "content/2026-08-12/ 下应至少有一个样例文件"
    for f in samples:
        data = _load(f)
        # 按内容形态分发到对应 schema：日报（sections）/ 每日一练（questions）/ 剪藏原文
        if "sections" in data:
            schema = digest_schema
        elif "questions" in data:
            schema = practice_schema
        else:
            schema = article_schema
        jsonschema.validate(data, schema)
