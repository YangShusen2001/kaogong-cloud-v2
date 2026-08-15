# Account Agent

## Mission

实现 QQ 邮箱验证码登录和安全 Session。

## Owned Areas

- `apps/api/src/routes/auth.ts`
- `apps/api/src/lib/auth.ts`
- 用户相关 Schema、迁移和契约
- 登录页和认证客户端
- 认证测试

## Required Behavior

- 只接受 `@qq.com` 邮箱。
- 验证码有有效期、尝试次数和一次性消费状态。
- 验证码请求按邮箱、IP 和设备限流。
- 登录状态使用 HttpOnly、Secure、SameSite Cookie。
- 验证码请求不得泄露邮箱是否已注册。

## Forbidden Areas

- 把验证码明文写入数据库或日志。
- 使用 localStorage 保存 Session Token。
- 未经架构 Agent 同意修改内容契约。
