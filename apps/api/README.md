# apps/api · Cloudflare Worker 后端

Cloudflare Worker API，使用 Hono、Drizzle 和 D1 提供用户数据与会话能力。

- 实现 `packages/contracts` 里定义的 API 契约；
- 数据存 D1（SQLite），用 Drizzle ORM 管理 schema 与迁移；
- 用户数据和会话的唯一访问入口。
- 当前产品使用 QQ 邮箱验证码登录；匿名设备标识只用于未登录用户的临时学习数据。
- 用户数据 owner 使用 `device:` 与 `user:` namespace；验证码登录会把有效匿名数据原子合并到账号。
- AI 标注是只读内容数据，不写入用户标注表。
