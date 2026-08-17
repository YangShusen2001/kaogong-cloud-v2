# 安全说明

## 报告漏洞

请**不要**在公开 issue 中提交安全漏洞。请通过以下方式私下报告：

- GitHub Security Advisory（推荐）：仓库页面 → Security → Report a vulnerability
- 或邮件联系维护者（见仓库主页）

请提供：漏洞描述、复现步骤、影响范围、建议修复方案。

## 安全设计要点

- 密钥与凭据只存在环境变量 / secrets（`.env.local`、Worker secrets），仓库不包含真实值。
- 验证码按邮箱 / IP / 设备三维限流；密码使用 PBKDF2 哈希。
- AI 输出经 DOMPurify 消毒后渲染，不直接注入 HTML。
- 会话 Cookie 使用 `HttpOnly + Secure + SameSite=Lax`；API 使用 CORS 白名单。
- AI 解析的邀请码共享配额在数据库层原子扣减，防并发超发。
