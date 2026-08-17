# ADR 0006：每日摘要使用独立 Resend Email API

- **状态**：已接受
- **日期**：2026-08-15

## 背景

验证码通过 Cloudflare `EMAIL` binding 发送，日报则需要稳定幂等键、供应商消息 ID 对账、无序 webhook 和永久退信抑制。两类邮件不能共享 provider 语义。

## 决策

- `EMAIL` 仅注入 `verificationMailProvider`；日报使用独立 `NewsletterMailProvider`。
- Resend `POST /emails` 的 `Idempotency-Key` 原样使用 `mail_deliveries.id`，不使用 batch endpoint，保留每位用户独立退订链接。
- 接受结果先在 fenced processing 行持久化 `provider_message_id`，再标记 sent。已知 provider ID 的不确定结果只通过 `GET /emails/:id` 对账，不盲目 POST。
- 网络、超时和 malformed 2xx 为 `outcome_unknown`；429/5xx 和并发幂等 409 可重试，其余 4xx 永久失败。
- Resend webhook 先对原始 body 验证 Svix HMAC，再解析 JSON；事件按 `svix-id` 去重，状态不得因乱序回退。
- 永久退信、投诉和 provider suppression 永久抑制订阅并取消开放投递，不提供 unsuppress API。

## 后果

本地具备 provider、对账和抑制能力，但生产 blocker 仍保持 open。只有完成发件域、密钥、webhook 配置、批量运行、bounce/complaint 演练和真实投递证据后才能关闭。
