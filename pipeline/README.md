# pipeline · 内容管道

把官方来源抓取后，产出符合 `content/schema/*.json` 契约的结构化 JSON，供 `apps/web`（Astro）消费。

## 结构

```
pipeline/
├── pyproject.toml      依赖与工具配置（PEP 621，uv/pip 通用）
├── src/kaogong/        管道源码
│   ├── models.py       领域模型（dataclass，snake_case → to_json 输出 camelCase）
│   └── digest.py        旧 markdown → DailyDigest 的解析器（纯函数）
└── tests/              pytest 测试
```

## 约定

- **JSON 是跨语言传输格式，键名用 camelCase**；Python 内部用 snake_case，序列化时统一转换。
- **契约权威在 `content/schema/*.json`**：管道产出必须通过 JSON Schema 校验，不能只依赖脚本没有抛异常。
- AI 返回结构化 JSON，程序负责原文片段定位、偏移计算、长度校验和失败状态。
- 单篇 AI 失败可以降级发布原文，但必须写入 `aiStatus` 和失败原因。
- 来源失败、内容数量异常或 Schema 失败时，质量状态必须非成功，不得静默发布。
- 具体规则见 `AGENTS.md`、`docs/product/ai-annotation-rules.md` 和 `docs/architecture/ai-annotation.md`。

## 运行

```sh
# 建议用 uv（Python 界的 pnpm）：uv sync
# 现在用 venv 也行：
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest -q
```
