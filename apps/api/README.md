# apps/api · Cloudflare Worker 后端

占位目录。阶段 4 用 `wrangler init` 在此初始化 Worker（Hono + Drizzle + D1）。

- 实现 `packages/contracts` 里定义的 API 契约；
- 数据存 D1（SQLite），用 Drizzle ORM 管理 schema 与迁移；
- 匿名设备标识，无账号体系（见 docs/adr/0002-feature-scope.md）。

现在无需安装任何依赖。
