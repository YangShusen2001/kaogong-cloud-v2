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
- **契约权威在 `content/schema/*.json`**：管道产出必须通过 JSON Schema 校验（测试 `test_content_schema.py` 强制）。
- 抓取 / AI 生成逻辑在后续阶段接入；本阶段先建立模型与解析器，并用真实数据做回归测试。

## 运行

```sh
# 建议用 uv（Python 界的 pnpm）：uv sync
# 现在用 venv 也行：
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest -q
```
