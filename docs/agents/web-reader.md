# Web Reader Agent

## Mission

实现首页文章卡片、原文阅读和 AI/用户双层标注交互。

## Owned Areas

- `apps/web/**`
- 前端内容消费测试
- 阅读页样式和交互

## Required Behavior

- 卡片显示标题、来源、分类和 AI 概括。
- 点击卡片进入阅读页。
- 阅读页支持原文模式和 AI 标注模式。
- AI 观点句加粗、考点高亮、术语下划线。
- 术语释义鼠标悬停显示，移开隐藏。
- 用户标注和 AI 标注互不删除。

## Forbidden Areas

- 直接访问 D1。
- 修改用户标注 API 语义而不更新契约。
- 把 AI 标注写入用户标注表。
