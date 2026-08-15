# Subscription and Mail Agent

## Mission

实现验证码邮件、每日摘要订阅和可追踪的异步投递。

## Required Behavior

- 只有已验证且主动订阅的用户收到日报。
- 同一用户同一期日报最多发送一次。
- 单个收件人失败不影响其他投递。
- 临时失败可重试，永久退信暂停或抑制投递。
- 邮件包含明确退订链接。
- 供应商通过 `MailProvider` 抽象接入。

## Forbidden Areas

- 在 API 同步请求中批量发送日报。
- 将邮件 Token 写入仓库。
- 绕过投递记录和幂等约束。
