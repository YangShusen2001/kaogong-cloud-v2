# TASK-0013：鉴权与 API 健壮性

## Status

pending

## Owner

account-agent

## Dependencies

- TASK-0008

## Goal

修复验证码 `verify` 无 IP/设备频控、`consumed_at` 预标记的崩溃窗口、每日一练 `correct > total` 未校验，以及 `/api/explain` 限流可被 `X-Device-Id` 轮换绕过与无超时（提案 0003 阶段 B）。

## Allowed Files

- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/practice.ts`
- `apps/api/src/routes/explain.ts`
- `apps/api/src/lib/deepseek.ts`
- `packages/contracts/src/api.ts`
- `apps/api/test/` 相关测试
- `docs/proposals/0003-content-quality-and-integrity-baseline.md`

## Acceptance Criteria

- [ ] `/email/verify` 增加 IP/设备频控，无法被无频控地反复爆破锁死账号。
- [ ] 验证码发送流程不存在「已发信却永久 consumed」的崩溃窗口（调整状态机或清理策略）。
- [ ] `practice` 拒绝 `correct > total`。
- [ ] `/api/explain` 限流抗 `X-Device-Id` 轮换（或接入 Cloudflare Rate Limiting）；`explainText` 有空结果/超时保护。

## Verification

```text
pnpm --filter @kaogong/api test
pnpm --filter @kaogong/api typecheck
```

## Handoff

```text
任务：TASK-0013 鉴权与 API 健壮性
负责人：account-agent
修改文件：待填写
实现内容：待填写
契约变化：待填写（practiceSubmitSchema 可能收紧，注意与 TASK-0011 共享 packages/contracts）
测试命令：pnpm --filter @kaogong/api test；pnpm --filter @kaogong/api typecheck
测试结果：待填写
已知问题：生产 D1 batch 路径未在 CI 覆盖，需下游 test-security 验证
下游 Agent 注意事项：验证码状态机改动需保持 consume_token 原子性
是否满足验收标准：待填写
```
