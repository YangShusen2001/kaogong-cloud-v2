# TASK-0010：内容清洗与源适配正确性

## Status

pending

## Owner

content-pipeline-agent

## Dependencies

- TASK-0009

## Goal

修复清洗与源适配导致的内容正确性缺陷：HTML 实体双编码残留、`pubDate` 恒为空、导航标签被当标题、重复 URL 计数/覆盖、评论栏目混入要闻动态、摘要/术语长度按码点误计、标注 `id` 内嵌旧偏移、去重误杀（提案 0003 阶段 A/C）。

## Allowed Files

- `pipeline/src/kaogong/clip.py`
- `pipeline/src/kaogong/sources.py`
- `pipeline/src/kaogong/article_ai.py`
- `pipeline/src/kaogong/build.py`
- `pipeline/src/kaogong/dedupe.py`
- `pipeline/tests/` 相关测试
- `content/schema/article.schema.json`（仅当调整 `pubDate`/摘要校验时）
- `docs/proposals/0003-content-quality-and-integrity-baseline.md`

## Acceptance Criteria

- [ ] `_clean` / `normalize_text` 循环 unescape 至稳定；`analyze_article` 计算偏移前先归一化正文；段落/标题/keySentences 不再残留字面实体（回归用例）。
- [ ] `url_date` 覆盖 `/YYYYMMDD/`、`/YYYYMM/`、未补零 `/YYYY/M/D/` 形态；非 legacy 文章 `pubDate` 非空（回归用例）。
- [ ] `_extract_pubdate` 过滤导航标签（应用 `title_min`），日报不再出现「头条」「南方快评」等标题。
- [ ] `clip_content` 按 id 去重，重复 `sourceUrl` 不重复计数/覆盖。
- [ ] 评论栏目（天府评论 / 交汇点时评）使用独立 slot/section，不再混入四川/江苏要闻动态。
- [ ] 摘要 80–120 / 术语 30–80 的语义校验按 CJK 字符统计，而非码点 `len()`。
- [ ] `normalize_article` 重定位标注时同步重写 annotation `id`，`id` 内嵌偏移与实际一致。
- [ ] `is_same_event` 改为最长公共子串判定，不误杀独立文章（回归用例）。

## Verification

```text
pytest pipeline/tests -q
```

## Handoff

```text
任务：TASK-0010 内容清洗与源适配正确性
负责人：content-pipeline-agent
修改文件：待填写
实现内容：待填写
契约变化：待填写
测试命令：pytest pipeline/tests -q
测试结果：待填写
已知问题：待填写
下游 Agent 注意事项：实体归一化会改变段落文本长度，注意与前端 unescapeArticle 的一致性
是否满足验收标准：待填写
```
