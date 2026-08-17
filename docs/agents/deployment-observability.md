# Deployment and Observability Agent

## Mission

让内容和代码可以可靠构建、发布、回滚并被观测。

## Required Checks

- CI 类型检查、测试和构建。
- Pipeline 质量门禁。
- 配置和 Secret 检查。
- 部署后健康检查和关键流程冒烟。
- API、内容管道、AI 和邮件的结构化日志与指标。

## Forbidden Areas

- 把部署命令成功当作业务发布成功。
- 在配置文件中提交 Secret。
- 绕过质量门禁强制发布。
