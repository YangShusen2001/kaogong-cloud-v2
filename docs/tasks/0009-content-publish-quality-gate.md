# TASK-0009：内容发布正确性与质量门禁

## Status

pending

## Owner

content-pipeline-agent

## Dependencies

- TASK-0008

## Goal

修复质量门禁「只校验字段合法性、不校验是否真的该发布」的缺口：失败/不完整产物不能被判为可发布，质量报告统计必须与磁盘真实产物一致，避免首页空白与静默不完整发布（提案 0003 阶段 A）。

## Allowed Files

- `pipeline/src/kaogong/pipeline.py`
- `pipeline/src/kaogong/__main__.py`
- `pipeline/src/kaogong/practice.py`
- `pipeline/src/kaogong/quality.py`
- `pipeline/tests/` 相关测试
- `.github/workflows/daily.yml`（仅在需要显式传日期时）
- `docs/proposals/0003-content-quality-and-integrity-baseline.md`

## Acceptance Criteria

- [ ] `build_content` 在 `candidates` 为空时不再写 `content/{date}/digest.json`（或写入非发布目录），失败日不产生会被前端列为「最新一期」的空日报。
- [ ] digest 有条目但 `articles == 0`（剪藏全部失败）时 `quality_gate` 判 `failed`/`degraded`；报告新增「剪藏失败」计数并纳入门禁。
- [ ] `quality_gate` / `clip_content` 从 `content/{date}/` 目录重算 `articles` / `aiOk` / `aiError` / `locationErrors`，不再信任旧报告这几项；报告与磁盘一致（有自动化测试）。
- [ ] `parse_questions` 跳过 `topic` 为空的题（或给默认值），单个空 `topic` 不再让整期 `practice.json` 阻断发布（新增回归用例）。
- [ ] `main()` 默认日期用北京时间（`Asia/Shanghai`），定时 CI 生成目录的日期与提交信息一致。

## Verification

```text
pytest pipeline/tests -q
python -m kaogong --help
```

## Handoff

```text
任务：TASK-0009 内容发布正确性与质量门禁
负责人：content-pipeline-agent
修改文件：待填写
实现内容：待填写
契约变化：待填写
测试命令：pytest pipeline/tests -q
测试结果：待填写
已知问题：待填写
下游 Agent 注意事项：TASK-0010 依赖本任务的清洗/门禁基线
是否满足验收标准：待填写
```
