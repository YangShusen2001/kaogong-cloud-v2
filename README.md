# kaogong-cloud v2

面向公务员考生的时政文章聚合和学习网站。系统每天聚合官方时政来源，生成 AI 概括和原文标注，并通过 Astro 静态站提供阅读体验；用户通过 QQ 邮箱验证码登录后可以收藏、标注文章并订阅每日摘要。

> 原项目（参考/备份）在 `C:\Users\26671\Desktop\Shizheng\kaogong-cloud`，本仓库是全新绿场重构，与其完全隔离。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Astro + TypeScript（静态站） |
| 后端 | Cloudflare Worker：Hono + Drizzle ORM |
| 数据库 | Cloudflare D1（SQLite） |
| 内容管道 | Python（pytest，产出结构化 JSON 到 `content/`） |
| 契约 | `packages/contracts`（zod 单一事实源，前后端共享） |
| 调度/部署 | GitHub Actions + Cloudflare Pages/Workers |

## 目录结构

```
apps/
  web/               Astro 前端（首页 / 日报 / 收藏）
  api/               Worker 后端（Hono 路由 + Drizzle + D1）
packages/
  contracts/         契约包：内容类型 + API zod schema（唯一事实源）
content/             管道产出的内容 JSON（含 schema/ 与样例）
pipeline/            Python 内容管道（抓取源 → 组装 → 写 content/）
docs/
  product/           产品需求、AI 规则和验收标准
  architecture/      模块边界和技术方案
  agents/             Agent 角色和协作规范
  tasks/              可执行任务和 Handoff
  adr/                架构决策记录
  deployment.md       部署指南
.github/workflows/   CI 门禁
```

## 状态

- [x] 0/1 骨架 + 契约（monorepo + contracts）
- [x] 2 内容管道（HTTP/去重/DeepSeek/源适配/组装/出题）
- [x] 内容管道、静态文章和用户学习功能基础骨架
- [x] Astro 前端、Worker API、D1 和 CI 基础设施
- [x] AI 概括和三类 AI 标注质量门禁（本地门禁已实现；2026-08-14 报告因缺少 AI key 为 failed）
- [x] QQ 邮箱验证码认证（仓库本地已验证；生产事务邮件仍待部署）
- [ ] 每日摘要订阅和邮件投递（本地订阅/退订/lease 已实现，生产 provider 未接入）
- [ ] 生产部署和运行监控

## 本地开发

```sh
pnpm install   # 安装所有 workspace 依赖

# —— 内容管道（Python）——
cd pipeline
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"   # Windows
.venv/Scripts/python -m pytest -q                                          # 单测
.venv/Scripts/python -m kaogong 2026-08-12                                 # 抓取并写 content/{date}/digest.json（需联网）

# —— 后端（Worker + D1，测试跑本地内存 SQLite）——
pnpm --filter @kaogong/api test
pnpm --filter @kaogong/api dev          # wrangler dev，默认 8787

# —— 前端（Astro）——
pnpm --filter @kaogong/web test
pnpm --filter @kaogong/web check        # astro check 类型检查
pnpm --filter @kaogong/web dev          # astro dev，默认 4321

# —— 全仓门禁 ——
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

## 部署

见 `docs/deployment.md`（建 D1 库 → 迁移 → 部署 Worker → 部署 Pages → 联调）。

## 架构决策

开发规范入口是 `AGENTS.md`。产品和任务入口分别是 `docs/product/` 与 `docs/tasks/`；架构决策见 `docs/adr/`。
