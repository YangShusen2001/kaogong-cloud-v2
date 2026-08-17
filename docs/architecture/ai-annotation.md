# AI 标注架构

## 数据流

```text
抓取原文
  -> 清洗为 paragraphs
  -> AI 返回 summary 和原文片段
  -> 程序定位片段并计算偏移
  -> Schema 和质量门禁
  -> 写入 article JSON
  -> Astro 渲染
```

AI 不直接生成 HTML。前端只能根据经过校验的 `type/start/end` 渲染样式。

## 文章契约

新 Pipeline 文章产物使用以下顶层字段：

| 字段 | 规则 |
|---|---|
| `aiStatus` | `pending`、`ok` 或 `error` |
| `aiSummary` | 成功时必填；目标 80-120 字，允许 60-150 字 |
| `aiAnnotations` | 成功时为已定位标注；失败时必须为空数组 |
| `aiModel` | 实际调用的模型名称 |
| `aiPromptVersion` | 可追踪的 Prompt 版本 |
| `aiGeneratedAt` | ISO 8601 生成时间 |
| `sourceTextHash` | 规范化原文段落的 SHA-256 十六进制值 |
| `aiError` | `aiStatus=error` 时必填，最多 500 字符 |

历史文章可以暂时没有 `aiStatus`；TASK-0002 生成或重新处理的文章必须写完整状态。

每条 `aiAnnotations` 包含 `id`、`paragraphIndex`、`start`、`end`、`text`、`type`，政策术语可以包含 `explanation`。

JSON Schema 验证字段结构和长度；Pipeline 语义校验器另外验证：

- `start < end`。
- `paragraphIndex` 不越界。
- `paragraphs[paragraphIndex][start:end] === text`。
- 标注不跨段且 ID 唯一。
- 非 `term` 不允许释义。
- 原文 hash 与当前 paragraphs 一致。
- 每篇标注最多 `viewpoint=5`、`exam_point=8`、`term=5`。
- 偏移使用 UTF-16 code unit，与浏览器 Range 的字符串坐标一致。

日期质量报告还会把本次 `candidates` 和 `articles` 与最近一次有效报告比较。任一数量低于基线的 50% 时记录 `below_half_baseline`，防止来源或处理异常造成内容量静默骤降。

## 两类标注

### AI 标注

随文章内容发布，只读，包含 `viewpoint`、`exam_point` 和 `term`。

### 用户标注

属于用户，通过 API 写入 D1，包含个人高亮、下划线和注释。

两者必须在数据模型、删除逻辑和渲染状态上分开。

## 版本和重生成

AI 结果必须记录：

- 原文内容 hash。
- 模型名称。
- Prompt 版本。
- 生成时间。
- `aiStatus` 和错误原因。

原文变化后，旧偏移不能直接复用，必须重新定位或重新生成。
