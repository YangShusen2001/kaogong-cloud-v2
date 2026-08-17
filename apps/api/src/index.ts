/// <reference types="@cloudflare/workers-types" />
// Worker 入口：把 D1 绑定转成 drizzle 实例，交给 Hono 应用
import { createApp, processScheduledNewsletter, type AppConfig } from "./app";
import { createDb } from "./db";
import { cloudflareMailProvider, type EmailBinding } from "./lib/mail";
import { resendNewsletterMailProvider } from "./lib/resend-newsletter-provider";

interface Env {
  DB: D1Database;
  DEEPSEEK_API_KEY?: string;
  AUTH_SECRET?: string;
  /** 逗号分隔的允许跨源 Origin 白名单，如 https://kaogong.pages.dev */
  ALLOWED_ORIGINS?: string;
  EMAIL?: EmailBinding;
  MAIL_FROM?: string;
  JOB_SECRET?: string;
  PUBLIC_API_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_NEWSLETTER_FROM?: string;
  RESEND_WEBHOOK_SECRET?: string;
}

export function createConfig(env: Omit<Env, "DB">): AppConfig {
  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  return {
    deepseekKey: env.DEEPSEEK_API_KEY,
    authSecret: env.AUTH_SECRET,
    allowedOrigins,
    verificationMailProvider: env.EMAIL && env.MAIL_FROM ? cloudflareMailProvider(env.EMAIL, env.MAIL_FROM) : undefined,
    newsletterMailProvider: env.RESEND_API_KEY && env.RESEND_NEWSLETTER_FROM
      ? resendNewsletterMailProvider({ apiKey: env.RESEND_API_KEY, from: env.RESEND_NEWSLETTER_FROM })
      : undefined,
    resendWebhookSecret: env.RESEND_WEBHOOK_SECRET,
    jobSecret: env.JOB_SECRET,
    publicApiUrl: env.PUBLIC_API_URL,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createApp(createDb(env), createConfig(env)).fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await processScheduledNewsletter(createDb(env), createConfig(env));
  },
} satisfies ExportedHandler<Env>;
