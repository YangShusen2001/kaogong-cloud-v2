# TASK-0019：修复顶栏滚动抽搐（jitter）

## Status

pending

## Owner

web-reader-agent

## Dependencies

- TASK-0018

## Goal

按提案 0009，修复顶栏在「向下滑动一点点后停止」时出现的抽搐：采用方案 A——顶栏高度恒定，仅收缩 logo + 毛玻璃，消除布局位移。

## Allowed Files

- `apps/web/src/styles/global.css`
- `docs/proposals/0009-header-jitter-fix.md`

## Acceptance Criteria

- [ ] 向下滚动一点点、停止后顶栏不再抽搐。
- [ ] 滚动后 logo 收缩 + 毛玻璃背景仍生效。
- [ ] 顶栏仍固定（sticky），导航收起/展开行为不变。

## Verification

```text
pnpm --filter @kaogong/web check
```

## Handoff

```text
任务：TASK-0019 修复顶栏滚动抽搐
负责人：web-reader-agent
修改文件：
- apps/web/src/styles/global.css
实现内容：待实现（去掉 .top.scrolled 的 height:52px，保留 logo 收缩 + 毛玻璃）
契约变化：无
测试命令：待补充
测试结果：待补充
已知问题：待补充
下游 Agent 注意事项：待补充
是否满足验收标准：待补充
```
