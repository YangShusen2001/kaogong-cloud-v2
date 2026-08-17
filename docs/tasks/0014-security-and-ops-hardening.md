# TASK-0014：安全与运维加固

## Status

pending

## Owner

test-security-agent

## Dependencies

- TASK-0008

## Goal

修复本地审核服务无鉴权/CSRF/路径校验、退订 GET 副作用，以及验证码/会话/邮件投递等表无清理策略、`processing` 行永久滞留（提案 0003 阶段 B/C 的安全与运维项）。

## Allowed Files

- `pipeline/src/kaogong/review/server.py`
- `apps/api/src/routes/subscription.ts`
- `apps/api/src/lib/newsletter-delivery.ts`（stuck processing 处理）
- 相关测试
- `docs/proposals/0003-content-quality-and-integrity-baseline.md`

## Acceptance Criteria

- [ ] 本地审核服务状态变更端点有口令（环境变量 + 头校验）+ CSRF 防护；`date`/`id` 路径参数校验、不越出 `content/`；`/api/digest` 保存前过 digest Schema。
- [ ] 退订改为 POST + 确认页，不因邮件预取/链接扫描器误退订。
- [ ] `sessions` / `email_verification_codes` / `resend_webhook_events` / `mail_deliveries` 有清理策略；`reconcileAttempts >= 5` 且带 `providerMessageId` 的 `processing` 行不再永久滞留。

## Verification

```text
pytest pipeline/tests -q
pnpm --filter @kaogong/api test
```

## Handoff

```text
任务：TASK-0014 安全与运维加固
负责人：test-security-agent
修改文件：待填写
实现内容：待填写
契约变化：待填写
测试命令：pytest pipeline/tests -q；pnpm --filter @kaogong/api test
测试结果：待填写
已知问题：待填写
下游 Agent 注意事项：本地审核服务 CSRF 方案需在本地 .bat 启动流程同步
是否满足验收标准：待填写
```
