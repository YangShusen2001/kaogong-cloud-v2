# Agent Roles

## 协作原则

- 每个任务只有一个负责人。
- 共享契约和数据库 Schema 不允许多个 Agent 无协调并发修改。
- Agent 通过任务文件、契约、测试和 Handoff 交接。
- 开发 Agent 负责自己的单元测试；测试 Agent 负责独立验证。
- 部署成功不代表功能完成，必须通过验收和部署后检查。

## 角色

- `orchestrator.md`：拆任务、管理依赖、集成和完成判定。
- `architecture.md`：维护模块边界、契约和 ADR。
- `content-pipeline.md`：抓取、AI 概括、AI 标注和内容质量门禁。
- `web-reader.md`：首页卡片、阅读页和双层标注渲染。
- `account.md`：QQ 邮箱验证码和 Session。
- `subscription-mail.md`：订阅、退订和邮件投递。
- `test-security.md`：独立测试、安全审查和回归验证。
- `deployment-observability.md`：部署、日志、指标和发布验证。

## Handoff

所有角色都必须使用根目录 `AGENTS.md` 中的 Handoff 模板。
