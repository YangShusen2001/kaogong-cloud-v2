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
    samples = list((CONTENT / "2026-08-12").glob("*.json"))
    assert samples, "content/2026-08-12/ 下应至少有一个样例文件"
    for f in samples:
        data = _load(f)
        # 有 sections 的判定为日报，否则判定为剪藏原文
        schema = digest_schema if "sections" in data else article_schema
        jsonschema.validate(data, schema)
