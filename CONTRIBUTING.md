# 贡献指南

欢迎贡献。本项目采用「多 Agent 协作 + 契约先行」的开发方式，规则入口是根目录 `AGENTS.md`。

## 开发流程

1. 先读 `AGENTS.md` 和关联的产品 / 架构 / Agent 文档（`docs/product`、`docs/architecture`、`docs/agents`）。
2. 复杂改动先创建 `docs/tasks/` 任务文件，明确负责人、允许文件和验收标准。
3. **契约先行**：改数据或 API 先改 `packages/contracts`（zod 单一事实源）和 `content/schema/*.json`，再实现前后端。
4. 只改任务允许的文件范围，不覆盖他人工作。
5. 行为变化必须补测试。

## 质量门禁

提交前本地全量检查：

```sh
pnpm -r typecheck
pnpm -r test
pnpm --filter @kaogong/web check   # astro check
pnpm -r build                      # 需要 PUBLIC_API_BASE 环境变量
```

Python 管道（`cd pipeline`）：

```sh
.venv/Scripts/python -m pytest -q   # Windows
python -m pytest -q                 # Linux/macOS（先 pip install -e ".[dev]"）
```

Pipeline 输出「通过」= 内容产物满足 `docs/product/` 的质量门禁，而非脚本没抛异常。

## 提交信息

清晰描述「改了什么 + 为什么」，如 `修复：pubdate 源候选池扩到 limit×3，避免当天文章漏抓`。

## 内容与版权

- 仓库不包含真实抓取内容（`content/20*/` 已 gitignore），仅保留示例日 `content/2026-08-17/`。
- 抓取内容版权归原作者 / 媒体，不得向仓库提交真实抓取数据。
- 字体文件（商用字体）不进仓库，需自备授权。
