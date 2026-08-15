# Task Files

任务文件是 Agent 协作的持久化工作单，不依赖聊天记录。

## 命名

```text
NNNN-short-name.md
```

## 必填字段

- 状态：`pending`、`in_progress`、`blocked`、`reviewing`、`verified`、`completed`。
- 唯一负责人。
- 依赖任务。
- 允许修改的文件范围。
- 目标和验收标准。
- 验证命令。
- Handoff 记录。

## 规则

- 一个任务只能有一个负责人。
- 任务完成前必须运行验证命令。
- 修改共享契约前必须说明影响的消费者。
- 阻塞必须记录原因和解除条件。

## 模板

复制 `docs/tasks/_template.md` 创建新任务。
