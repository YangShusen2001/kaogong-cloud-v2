# apps/web · Astro 前端

Astro 静态前端，消费 `content/` 产物并调用 API 获取用户数据。

- 消费 `packages/contracts` 的类型；
- 消费 `content/` 里管道产出的内容（Astro content collection）；
- 调用 `apps/api` 的接口获取收藏、用户标注、做题和账号数据。
- AI 标注为内容只读数据，用户标注必须与 AI 标注分开渲染。
