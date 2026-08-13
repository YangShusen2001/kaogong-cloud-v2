# kaogong-cloud v2

考公（申论/时政）学习网站的规范化重构版。保留原项目「定时抓取 → 静态站 → Serverless」这个被验证的架构骨架，把手搓的部分全部换成工业标准工具，只保留核心功能。

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
  adr/               架构决策记录
  deployment.md      部署指南
.github/workflows/   CI 门禁
```

## 状态

- [x] 0/1 骨架 + 契约（monorepo + contracts）
- [x] 2 内容管道（HTTP/去重/DeepSeek/源适配/组装，抓取逻辑闭环）
- [x] 3 Astro 前端（渲染 + 极光/粒子 hero + 收藏）
- [x] 4 Worker API + D1（收藏/划线/每日一练 + zod 契约闭环）
- [ ] 5 部署上线（见 `docs/deployment.md`；划线/每日一练 UI 待补）
- [ ] 6 删债收尾

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

见 `docs/adr/`，入口 `0001-target-architecture.md`。
