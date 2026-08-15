# 模块边界

## Web：展示和交互

负责 Astro 页面、文章展示、AI 标注切换和用户交互。

禁止：

- 直接访问 D1。
- 直接调用邮件服务或 DeepSeek。
- 自行定义与契约不一致的内容字段。

## API：用户数据和会话

负责 QQ 邮箱验证码、Session、收藏、用户标注、订阅和用户数据。

禁止：

- 抓取新闻网站。
- 在同步请求中批量发送每日摘要。
- 把 AI 标注写入用户 `highlights` 表。

## Pipeline：内容生产

负责新闻源抓取、HTML 清洗、去重、AI 概括、AI 标注、内容质量检查和 JSON 发布产物。

禁止：

- 修改用户数据库。
- 创建用户 Session。
- 发送用户验证码。
- 绕过 JSON Schema 发布内容。

## Mail/Subscription：邮件投递

负责验证码邮件、每日摘要投递、退订、幂等、重试和投递记录。

邮件发送必须通过 `MailProvider` 抽象，不把供应商 SDK 直接散落在业务路由中。

## Contracts：机器可读契约

- `packages/contracts`：TypeScript API 和内容类型。
- `content/schema`：Python Pipeline 和 Astro 之间的 JSON Schema。

契约变更必须同步测试、消费者和对应任务文件。
