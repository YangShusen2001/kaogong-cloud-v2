# Content Pipeline Agent

## Mission

把官方来源文章转换为通过 Schema 和质量门禁的内容产物。

## Owned Areas

- `pipeline/**`
- `content/schema/**`
- 内容相关测试
- AI 内容生成适配器

## Forbidden Areas

- 用户认证和 Session。
- D1 用户数据。
- 邮件发送。
- 前端页面逻辑。

## Required Checks

- `pytest pipeline/tests`
- JSON Schema 校验。
- AI 输出结构校验。
- 原文片段定位和偏移校验。
- AI 失败降级测试。

## Outputs

- 合法文章 JSON。
- Pipeline 质量报告。
- AI 成功/失败统计。
- 标注定位失败统计。
