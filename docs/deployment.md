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

# 把 database_id 填进 apps/api/wrangler.toml 的 [[d1_databases]].database_id

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

成功后得到一个 Worker 域名，形如 `https://kaogong-api.<account>.workers.dev/`。记下它，这是前端的 `PUBLIC_API_BASE`。

另外，Worker 需要配置以下环境变量（Cloudflare Dashboard → Workers → kaogong-api → 设置 → 变量）：

- `AUTH_SECRET`：验证码哈希加盐密钥（任意足够长的随机串，如 `openssl rand -hex 32` 的输出）。**必填**。
- `DEEPSEEK_API_KEY`：DeepSeek API Key，用于划线 AI 解释与每日一练生成。不配则相关功能返回 503。
- `ALLOWED_ORIGINS`：允许跨源的前端域名（逗号分隔），如 `https://kaogong-web.pages.dev`。**必填**，否则浏览器会拦截跨源请求。
- `JOB_SECRET`：日报发行与投递内部任务密钥。**必填**，不得暴露给浏览器。
- `MAIL_FROM`：已在 Cloudflare Email Sending 启用域名下的验证码发件地址。
- `PUBLIC_API_URL`：Worker 对外 API 的同站点 HTTPS 地址，用于 newsletter 退订链接；没有 newsletter provider 时调度仍会安全跳过。

验证码使用 Cloudflare Email Sending Worker binding `EMAIL`。每日摘要属于订阅/批量邮件，不使用事务邮件 binding；生产环境必须为 `newsletterMailProvider` 接入支持订阅、退信和批量投递的供应商。

Session Cookie 使用 `HttpOnly + Secure + SameSite=Lax`。Pages 和 Worker 生产域名必须部署在同一站点下的自定义子域，例如 `www.example.com` 与 `api.example.com`；直接组合 `pages.dev` 和 `workers.dev` 时，浏览器不会在跨站 fetch 中发送 Lax Cookie。

## 3. 部署前端到 Pages

```sh
cd D:\kaogong-cloud-v2\apps\web
$env:PUBLIC_API_BASE = "https://kaogong-api.2667199938.workers.dev"
npx astro build
npx wrangler pages deploy dist --project-name kaogong-web
```

之后每次改前端，重跑这两行即可（`PUBLIC_API_BASE` 记得带上）。

> 也可以在建 Pages 项目后，去 Cloudflare Dashboard → Pages → kaogong-web → 设置 → 环境变量，把 `PUBLIC_API_BASE` 设为 Worker 地址，以后 `astro build` 就不用每次手写。

## 4. 发布门禁

`docs/release-readiness.json` 是机器可读的生产发布阻塞注册表。high/critical blocker 只要仍为 `open`，`pnpm release:check` 就返回非零；改为 `closed` 时必须同时提供 `closeEvidence.verifiedAt`、`closeEvidence.verifiedBy` 和可审计的 `closeEvidence.evidence`。

当前有两个独立的 high/open blocker：

- `REL-NEWSLETTER-PROVIDER`：缺少 newsletter provider、provider 幂等或结果对账、退信、批量投递和真实投递证据。
- `REL-PRODUCTION-DEPLOYMENT`：缺少生产配置、全部 D1 迁移、Worker 和 Pages 部署、同站点自定义域、部署后 GET smoke 和一次安全验证码邮件验证。

两个 blocker 必须分别满足关闭条件，任何一个都足以阻止发布。验证码仍使用 Cloudflare Email Sending `EMAIL` binding，不能把该事务邮件链路当作 newsletter provider，也不能用本地测试证明生产部署成功。

```sh
# 当前真实注册表：预期非零，同时输出两个 blocker id
pnpm release:check

# 门禁和通过/阻塞 fixture
pnpm test:release
```

关闭 blocker 时不得只改 `status`。`closeEvidence.evidence` 应指向可审计的 CI run、测试报告或发布验证记录，且必须先满足注册表中的全部 `closeCriteria`。

## 5. 分层验证

### 5.1 本地验证

本地验证不证明已部署，也不发送真实 newsletter：

```sh
pnpm --filter @kaogong/api test
pnpm --filter @kaogong/api typecheck
pnpm test:release
```

### 5.2 部署后只读冒烟

Pages 部署成功后，workflow 从 `cloudflare/wrangler-action` 的 `deployment-url` 输出设置 `PUBLIC_SITE_URL`，再运行：

```sh
PUBLIC_SITE_URL=https://<deployment>.pages.dev \
PUBLIC_API_BASE=https://api.example.com \
pnpm test:smoke
```

`scripts/smoke-release.mjs` 只发送 GET 请求，检查首页、从首页发现的阅读页、`/api/ping`、`/api/auth/session` 和 `/api/subscription`。匿名 auth/subscription 的 `401` 是允许结果。该脚本不创建账号、不请求验证码、不改变订阅或用户数据；浏览器视觉与交互验证仍由前端 Playwright lane 负责。

本地尚未执行生产部署或线上 smoke，不能把脚本测试通过描述为生产冒烟通过。

### 5.3 验证码事务邮件

验证码验证必须使用专门测试邮箱，在已部署 Worker 上请求一次验证码并完成登录，确认 `EMAIL` binding、发件域和 session cookie。验证码内容、邮箱地址、token 和 provider body 不得写入日志或发布证据。

### 5.4 Newsletter 投递不可用

订阅 API、发行幂等、退订、lease fencing 和重试的本地测试不等于 provider exactly-once，也不等于生产 newsletter 可投递。网络超时后供应商结果可能未知，本地状态会进入 `outcome_unknown`，接入方必须通过 provider idempotency key 或对账确认结果，不能盲目重发。当前没有 newsletter provider，禁止发送或声称发送了每日摘要；保持 `REL-NEWSLETTER-PROVIDER` open，直到供应商能力、独立集成、退信、批量投递、结果对账和真实投递验证均有证据。

## 6. （可选）本地联调

不部署、本地跑：

```sh
# 终端 1：本地 Worker（默认 8787，带本地 D1）
cd apps/api && npx wrangler dev

# 终端 2：本地前端（默认 4321，PUBLIC_API_BASE 指向 8787）
cd apps/web && PUBLIC_API_BASE=http://127.0.0.1:8787 npx astro dev
```

打开 `http://localhost:4321`。

## 7. （可选）自动化每日更新

`.github/workflows/daily.yml` 已实现每日自动"抓取 → 生成 content/ → 部署"，需往 GitHub Secrets 加：

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（wrangler 部署用）
- `DEEPSEEK_API_KEY`（AI 每日一练出题用，不配则跳过出题）
- `PUBLIC_API_BASE`（Worker 域名，烤进静态站；不配会 fail-fast 中止构建）
- `PUBLIC_API_URL`（Worker 对外 API 地址；接入 newsletter provider 前也必须在 Worker 环境中配置）

每日任务会先提交新内容，再执行 `pnpm release:check`，只有门禁通过才构建和部署 Pages。任务运行期间如果 `main` 有其他提交，机器人会基于最新 `origin/main` rebase 后再推送；发生真实内容冲突时任务明确失败，禁止强推覆盖人工修改。部署动作使用 `cloudflare/wrangler-action@v4`，将实际 deployment URL 写入 job summary 和 `PUBLIC_SITE_URL`，供后续只读 smoke 使用。

### 排查顺序

1. `gh run list --workflow daily.yml --limit 5` 查看最近运行。
2. `gh run view <run-id> --log-failed` 查看第一个失败步骤。
3. 如果失败在“提交当日内容”，先处理 Git 并发或内容冲突；此时 Cloudflare 部署尚未执行。
4. 如果失败在“生产发布阻塞门禁”，查看 `docs/release-readiness.json`；不得绕过或伪造 close evidence。
5. 如果失败在“构建前端”，本地运行 `pnpm --filter @kaogong/web build`。
6. 如果失败在“部署到 Cloudflare Pages”，检查 GitHub Secrets 和 `npx wrangler@4 pages deployment list --project-name kaogong-web`。
7. 如果失败在“部署后只读冒烟”，从 job summary 获取 `PUBLIC_SITE_URL`，复现 `pnpm test:smoke`；不要把失败脚本重试描述为线上通过。

生产部署 blocker 关闭必须同时满足：所需配置存在、全部 D1 迁移已应用、Worker 和 Pages 均有部署记录、同站点自定义域生效、线上 GET smoke 通过，并完成一次不泄露敏感信息的验证码事务邮件验证。
