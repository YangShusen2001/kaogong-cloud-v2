# 部署指南

把 kaogong-cloud-v2 部署到 Cloudflare（Worker + D1 + Pages）。全程免费额度内。

> 前置：装好 Node/pnpm，装好 wrangler：`pnpm dlx wrangler --version`（或 `npm i -g wrangler`）。

## 0. 登录 Cloudflare

```sh
npx wrangler login
```

浏览器授权后即可。后续所有 wrangler 命令都带你的账号身份。

## 1. 建 D1 数据库并迁移

```sh
cd apps/api

# 创建数据库，记下返回的 database_id
npx wrangler d1 create kaogong-db

# 把 database_id 填进 wrangler.toml 的 [[d1_databases]].database_id（替换 REPLACE_ME）

# 应用迁移（本地验证）
npx wrangler d1 migrations apply kaogong-db --local

# 应用到线上
npx wrangler d1 migrations apply kaogong-db --remote
```

## 2. 部署后端 Worker

```sh
cd apps/api
npx wrangler deploy
```

成功后得到一个 Worker 域名，形如 `https://kaogong-api.<你的子域>.workers.dev`。记下它，这是前端的 `PUBLIC_API_BASE`。

## 3. 部署前端到 Pages

> 环境变量用 PowerShell 语法（`$env:`）；bash 用户改用 `PUBLIC_API_BASE=... npx astro build` 前缀写法。

```powershell
cd apps/web
# 构建时注入后端地址（Astro 的 PUBLIC_ 环境变量会打进前端 bundle）
$env:PUBLIC_API_BASE = "https://kaogong-api.<你的子域>.workers.dev"
npx astro build
npx wrangler pages deploy dist --project-name kaogong-web
```

之后每次改前端，重跑这几行即可（`PUBLIC_API_BASE` 记得带上）。

> 也可以在建 Pages 项目后，去 Cloudflare Dashboard → Pages → kaogong-web → 设置 → 环境变量，把 `PUBLIC_API_BASE` 设为 Worker 地址，以后 `astro build` 就不用每次手写。

## 4. 验证

1. 打开 Pages 域名（`https://kaogong-web.pages.dev`），能看到首页 + 日报；
2. 打开日报页，点「收藏」，再进「我的收藏」页，能看到刚收藏的条目 —— 说明前端 → Worker → D1 全链路通了。

## 5. （可选）本地联调

不部署、本地跑：

```powershell
# 终端 1：本地 Worker（默认 8787，带本地 D1）
cd apps/api
npx wrangler dev

# 终端 2：本地前端（默认 4321，PUBLIC_API_BASE 指向 8787）
cd apps/web
$env:PUBLIC_API_BASE = "http://127.0.0.1:8787"
npx astro dev
```

打开 `http://localhost:4321`。

## 6. （可选）自动化每日更新

当前 CI（`.github/workflows/ci.yml`）只跑检查不部署。要自动"抓取 → 生成 content/ → 部署"，后续再补一个 `deploy.yml`，需要往 GitHub Secrets 加：

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（wrangler 部署用）
- `DEEPSEEK_API_KEY`（AI 总结/出题用，可选）

加好后我可以帮你写那个工作流。
