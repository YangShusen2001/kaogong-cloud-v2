# TASK-0005：每日摘要订阅和邮件投递

## Status

blocked

## Owner

subscription-mail-agent

## Dependencies

- TASK-0004
- TASK-0002

## Goal

向已验证且主动订阅的用户可靠发送每日 AI 概括摘要。

## Allowed Files

- `apps/api/**` 邮件和订阅相关文件
- `packages/contracts/src/api.ts`
- `.github/workflows/**`
- 邮件相关迁移和测试

## Acceptance Criteria

- [x] 支持订阅、退订和投递记录。
- [x] 同一用户同一期日报最多发送一次。
- [x] 失败可追踪，临时失败可重试。
- [x] 邮件包含退订能力（登录后个人中心）。
- [x] 不在 API 同步用户请求中批量发送邮件。
- [ ] 生产 newsletter provider 支持订阅、退订、退信处理和批量投递，且已与验证码事务邮件链路分离接入。
- [x] 个人中心按 `SubscriptionResponse.deliveryAvailable` 如实展示投递可用性，并有认证和订阅 E2E 覆盖。
- [x] 本地投递使用 lease fencing，过期且无法确认供应商结果的终态为 `outcome_unknown`，持久化错误只保留脱敏分类。

## Blocked

- 外部邮件阻塞：`REL-NEWSLETTER-PROVIDER` 仍为 high/open。尚未选择或接入支持订阅、退订、退信处理和批量投递的 newsletter provider，也没有 provider idempotency/reconciliation、bounce、bulk 或真实 newsletter 投递证据。
- 已解除的本地阻塞：根目录 `DESIGN.md` 已从现有界面提炼；个人中心已消费 `deliveryAvailable`，投递不可用时禁止新订阅但允许现有用户退订；认证、订阅和账户状态 E2E 已覆盖三种浏览器/设备配置；六张账号页视觉证据经两轮独立评审均为 PASS。
- 解除条件：完成 provider 选型与独立集成，验证 provider idempotency 或结果对账、退信和批量投递，取得可审计的真实投递证据；随后按 `docs/release-readiness.json` 填写完整关闭证据。

## Verification

```text
pnpm --filter @kaogong/api test
pnpm -r typecheck
pnpm --filter @kaogong/web test:e2e
```

## Handoff

```text
任务：TASK-0005 每日摘要订阅和邮件投递
负责人：subscription-mail-agent
修改文件：订阅/发行/投递表和路由、邮件抽象、个人中心、迁移与 API 测试
实现内容：`subscriptions` 作为唯一订阅事实源；每次订阅生成新退订 token generation；主动订阅/退订；issue 和唯一投递；JOB_SECRET 内部端点；每批 20 封；3 次尝试；lease fencing；`outcome_unknown`；脱敏错误分类；无 provider 的 scheduled boundary 安全跳过
契约变化：新增 Subscription；新增内部 newsletter issue/process API
测试命令：pnpm -r typecheck；pnpm -r test；pnpm -r build；pnpm --filter @kaogong/web check；pnpm --filter @kaogong/web test:e2e；pytest pipeline/tests -q；pnpm test:release；pnpm release:check
测试结果：当前仓库本地证据为 API 103/103、Web 单元 16/16、newsletter 24/24、scheduled 3/3、迁移 8/8、划线 20/20、账号合并 16/16、Playwright 27/27、构建 39 页、API/workspace typecheck 通过及双轮视觉 PASS；release 结果见 TASK-0008；未发送真实 newsletter
已知问题：未运行生产 Worker/Pages 冒烟或验证码事务邮件；未发送真实 newsletter，且生产 newsletter provider 尚未选型或接入
下游 Agent 注意事项：不得把本地发行幂等、lease fencing、退订、重试和账户 E2E 描述为 provider exactly-once 或生产可投递；`outcome_unknown` 必须由 provider 幂等键或对账处理，不能盲目重发
是否满足验收标准：本地代码和账户体验验收已满足；外部 provider 与真实投递验收未满足，任务保持 blocked
```
