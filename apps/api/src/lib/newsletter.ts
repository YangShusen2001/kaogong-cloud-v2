import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppConfig, DB } from "../app";
import { mailDeliveries, newsletterIssues, subscriptions, users } from "../db/schema";
import { constantEqual } from "./auth";
import { diagnosticInfo } from "./diagnostics";
import { badInput, fail } from "./http";
export { processNewsletterBatch, type NewsletterBatchResult } from "./newsletter-delivery";
import { processNewsletterBatch } from "./newsletter-delivery";
export { deriveUnsubscribeToken } from "./newsletter-token";
import { provisionUnsubscribeToken } from "./newsletter-token";

function authorized(config: AppConfig, header: string | undefined): boolean {
  return Boolean(config.jobSecret && header && constantEqual(header, config.jobSecret));
}

async function fanOut(db: DB, issueId: string, now: number, authSecret: string): Promise<void> {
  const active = await db.select().from(subscriptions).where(eq(subscriptions.status, "subscribed")).all();
  for (const subscription of active) {
    if (!await provisionUnsubscribeToken(db, subscription.userId, authSecret)) continue;
    const user = await db.select().from(users).where(eq(users.id, subscription.userId)).get();
    if (!user?.email) continue;
    await db.insert(mailDeliveries).values({
      id: crypto.randomUUID(), issueId, userId: user.id, recipient: user.email,
      status: "pending", attempts: 0, lastError: "", nextAttemptAt: 0,
      leaseToken: null, leaseExpiresAt: null, sentAt: null, createdAt: now,
    }).onConflictDoNothing().run();
  }
}

export function newsletterRoutes(db: DB, config: AppConfig) {
  const routes = new Hono();
  routes.post("/issues", async (context) => {
    if (!authorized(config, context.req.header("x-job-secret"))) return fail(context, 401, "JOB_AUTH_REQUIRED", "未授权任务");
    if (!config.authSecret) return fail(context, 503, "AUTH_UNAVAILABLE", "认证服务未配置");
    const body = await context.req.json<{ date?: string; subject?: string; text?: string }>();
    if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/) || !body.subject || !body.text) return badInput(context, "发行参数非法");
    const inserted = await db.insert(newsletterIssues).values({
      id: crypto.randomUUID(), issueDate: body.date, subject: body.subject, textContent: body.text,
      status: "published", createdAt: Date.now(),
    }).onConflictDoNothing().returning().all();
    const issue = inserted[0] ?? await db.select().from(newsletterIssues).where(eq(newsletterIssues.issueDate, body.date)).get();
    if (!issue) return fail(context, 500, "ISSUE_CREATE_FAILED", "发行创建失败");
    if (issue.subject !== body.subject || issue.textContent !== body.text) return fail(context, 409, "ISSUE_PAYLOAD_CONFLICT", "同日发行内容冲突");
    diagnosticInfo({ event: inserted.length === 1 ? "newsletter.issue.created" : "newsletter.issue.reused", issueId: issue.id });
    await fanOut(db, issue.id, Date.now(), config.authSecret);
    return context.json({ ok: true, data: { issueId: issue.id } }, inserted.length === 1 ? 201 : 200);
  });
  routes.post("/process", async (context) => {
    if (!authorized(config, context.req.header("x-job-secret"))) return fail(context, 401, "JOB_AUTH_REQUIRED", "未授权任务");
    const result = await processNewsletterBatch(db, config);
    if (result.kind === "processed") return context.json({ ok: true, data: { processed: result.processed, sent: result.sent } });
    const errors = {
      provider_unavailable: ["MAIL_UNAVAILABLE", "摘要邮件服务未配置"],
      public_url_unavailable: ["PUBLIC_URL_UNAVAILABLE", "未配置公开 API 地址"],
      auth_unavailable: ["AUTH_UNAVAILABLE", "认证服务未配置"],
    } as const;
    const error = errors[result.reason];
    return fail(context, 503, error[0], error[1]);
  });
  return routes;
}
