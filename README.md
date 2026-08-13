# kaogong-cloud v2

考公（申论/时政）学习网站的规范化重构版。目标：保留原项目「定时抓取 → 静态站 → Serverless」这个被验证的架构骨架，但把所有手搓的部分换成工业标准工具，只保留核心功能。

> 原项目（参考/备份）在 `C:\Users\26671\Desktop\Shizheng\kaogong-cloud`，本仓库是全新绿场重构，与其完全隔离。

## 技术栈（目标）

| 层 | 选型 |
|---|---|
| 前端 | Astro + TypeScript（静态站） |
| 后端 | Cloudflare Worker：Hono + Drizzle ORM |
| 数据库 | Cloudflare D1（SQLite） |
| 内容管道 | Python（uv + pytest，产出结构化内容到 `content/`） |
| 契约 | `packages/contracts`（前后端共享类型） |
| 调度/部署 | GitHub Actions + Cloudflare Pages/Workers |

## 目录结构

```
apps/web/        Astro 前端（阶段 3）
apps/api/        Worker 后端（阶段 4）
packages/contracts/  共享契约类型（唯一事实源）
content/         管道产出的内容文件（阶段 2）
pipeline/        内容管道（阶段 2）
docs/adr/        架构决策记录（ADR）
```

## 状态

- [x] 阶段 0/1：目标架构 + 范围决策 + monorepo 骨架 + 契约包
- [ ] 阶段 2：内容管道契约化
- [ ] 阶段 3：Astro 前端重建
- [ ] 阶段 4：Worker API + D1
- [ ] 阶段 5：接线 + 上线切换
- [ ] 阶段 6：删债收尾

## 常用命令

```sh
pnpm install          # 安装所有 workspace 依赖
pnpm -r typecheck     # 全仓类型检查
pnpm -r test          # 全仓测试
pnpm -r build         # 全仓构建
```

## 架构决策

见 `docs/adr/`，入口是 `0001-target-architecture.md`。
