import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppConfig, DB } from "../app";
import { mailDeliveries, newsletterIssues, subscriptions, users } from "../db/schema";
import { constantEqual, sha256 } from "./auth";
import { diagnosticInfo, diagnosticWarn } from "./diagnostics";
import { badInput, fail } from "./http";

const MAX_ATTEMPTS = 3;
const LEASE_DURATION = 5 * 60_000;

function authorized(config: AppConfig, header: string | undefined): boolean {
  return Boolean(config.jobSecret && header && constantEqual(header, config.jobSecret));
}

export async function deriveUnsubscribeToken(userId: string, nonce: string, authSecret: string): Promise<string> {
  return sha256(`unsubscribe:${userId}:${nonce}:${authSecret}`);
}

async function provisionUnsubscribeToken(db: DB, userId: string, authSecret: string): Promise<string | undefined> {
  let current = await db.select().from(subscriptions).where(and(
    eq(subscriptions.userId, userId), eq(subscriptions.status, "subscribed"),
  )).get();
  while (current) {
    const nonce = current.unsubscribeTokenNonce ?? crypto.randomUUID();
    const token = await deriveUnsubscribeToken(userId, nonce, authSecret);
    const tokenHash = await sha256(token);
    if (current.unsubscribeTokenNonce === nonce && current.unsubscribeTokenHash === tokenHash) return token;
    const observedNonce = current.unsubscribeTokenNonce === null
      ? isNull(subscriptions.unsubscribeTokenNonce)
      : eq(subscriptions.unsubscribeTokenNonce, current.unsubscribeTokenNonce);
    const observedHash = current.unsubscribeTokenHash === null
      ? isNull(subscriptions.unsubscribeTokenHash)
      : eq(subscriptions.unsubscribeTokenHash, current.unsubscribeTokenHash);
    const updated = await db.update(subscriptions).set({
      unsubscribeTokenNonce: nonce,
      unsubscribeTokenHash: tokenHash,
      updatedAt: Date.now(),
    }).where(and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "subscribed"),
      observedNonce,
      observedHash,
    )).returning().all();
    if (updated.length === 1) return token;
    current = await db.select().from(subscriptions).where(and(
      eq(subscriptions.userId, userId), eq(subscriptions.status, "subscribed"),
    )).get();
  }
  return undefined;
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

async function claimDelivery(db: DB, delivery: typeof mailDeliveries.$inferSelect, now: number) {
  const leaseToken = crypto.randomUUID();
  const expiredLease = delivery.status === "processing" && delivery.leaseToken !== null && delivery.leaseExpiresAt !== null
    ? and(
      eq(mailDeliveries.status, "processing"),
      eq(mailDeliveries.leaseToken, delivery.leaseToken),
      eq(mailDeliveries.leaseExpiresAt, delivery.leaseExpiresAt),
      isNotNull(mailDeliveries.leaseExpiresAt),
      lte(mailDeliveries.leaseExpiresAt, now),
    ) : undefined;
  const observed = delivery.status === "processing" ? expiredLease : and(
      eq(mailDeliveries.status, delivery.status),
      eq(mailDeliveries.nextAttemptAt, delivery.nextAttemptAt),
      lte(mailDeliveries.nextAttemptAt, now),
    );
  if (!observed) return undefined;
  const claimed = await db.update(mailDeliveries).set({
    status: "processing",
    attempts: sql`${mailDeliveries.attempts} + 1`,
    leaseToken,
    leaseExpiresAt: now + LEASE_DURATION,
  }).where(and(eq(mailDeliveries.id, delivery.id), lt(mailDeliveries.attempts, MAX_ATTEMPTS), observed)).returning().all();
  const row = claimed[0];
  return row ? { ...row, leaseToken } : undefined;
}

async function terminalizeExhaustedLease(db: DB, delivery: typeof mailDeliveries.$inferSelect, now: number): Promise<boolean> {
  if (delivery.status !== "processing" || delivery.attempts < MAX_ATTEMPTS || delivery.leaseToken === null || delivery.leaseExpiresAt === null) {
    return false;
  }
  const finalized = await db.update(mailDeliveries).set({
    status: "outcome_unknown",
    lastError: "lease_expired",
    nextAttemptAt: 0,
    leaseToken: null,
    leaseExpiresAt: null,
  }).where(and(
    eq(mailDeliveries.id, delivery.id),
    eq(mailDeliveries.status, "processing"),
    eq(mailDeliveries.attempts, delivery.attempts),
    eq(mailDeliveries.leaseToken, delivery.leaseToken),
    eq(mailDeliveries.leaseExpiresAt, delivery.leaseExpiresAt),
    lte(mailDeliveries.leaseExpiresAt, now),
  )).returning().all();
  return finalized.length === 1;
}

type ProcessingConfig = {
  readonly newsletterMailProvider: NonNullable<AppConfig["newsletterMailProvider"]>;
  readonly publicApiUrl: string;
  readonly authSecret: string;
};

export type NewsletterBatchResult =
  | { readonly kind: "processed"; readonly processed: number; readonly sent: number }
  | { readonly kind: "skipped"; readonly reason: "provider_unavailable" | "public_url_unavailable" | "auth_unavailable" };

async function processDelivery(db: DB, config: ProcessingConfig, delivery: typeof mailDeliveries.$inferSelect & { readonly leaseToken: string }): Promise<boolean> {
  const issue = await db.select().from(newsletterIssues).where(eq(newsletterIssues.id, delivery.issueId)).get();
  const active = await db.select().from(subscriptions).where(and(
    eq(subscriptions.userId, delivery.userId), eq(subscriptions.status, "subscribed"),
  )).get();
  const owner = and(eq(mailDeliveries.id, delivery.id), eq(mailDeliveries.leaseToken, delivery.leaseToken));
  if (!issue || !active) {
    await db.update(mailDeliveries).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null }).where(owner).run();
    diagnosticInfo({ event: "newsletter.delivery.cancelled", issueId: delivery.issueId });
    return false;
  }
  try {
    const unsubscribeToken = await provisionUnsubscribeToken(db, delivery.userId, config.authSecret);
    if (!unsubscribeToken) {
      await db.update(mailDeliveries).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null }).where(owner).run();
      return false;
    }
    const unsubscribeUrl = `${config.publicApiUrl.replace(/\/$/, "")}/api/subscription/unsubscribe?token=${unsubscribeToken}`;
    await config.newsletterMailProvider.send({
      to: delivery.recipient,
      subject: issue.subject,
      text: `${issue.textContent}\n\n退订：${unsubscribeUrl}`,
    });
    const finalized = await db.update(mailDeliveries).set({
      status: "sent", sentAt: Date.now(), lastError: "", nextAttemptAt: 0,
      leaseToken: null, leaseExpiresAt: null,
    }).where(owner).returning().all();
    return finalized.length === 1;
  } catch {
    const terminal = delivery.attempts >= MAX_ATTEMPTS;
    const finalized = await db.update(mailDeliveries).set({
      status: terminal ? "failed" : "retry",
      nextAttemptAt: terminal ? 0 : Date.now() + 60_000 * 2 ** (delivery.attempts - 1),
      lastError: "provider_error", leaseToken: null, leaseExpiresAt: null,
    }).where(owner).returning().all();
    if (finalized.length === 1) {
      diagnosticWarn({ event: terminal ? "newsletter.delivery.failed" : "newsletter.delivery.retry", issueId: delivery.issueId, attempt: delivery.attempts });
    }
    return false;
  }
}

export async function processNewsletterBatch(db: DB, config: AppConfig): Promise<NewsletterBatchResult> {
  if (!config.newsletterMailProvider) {
    return { kind: "skipped", reason: "provider_unavailable" };
  }
  if (!config.publicApiUrl) {
    return { kind: "skipped", reason: "public_url_unavailable" };
  }
  if (!config.authSecret) {
    return { kind: "skipped", reason: "auth_unavailable" };
  }
  const processingConfig = {
    newsletterMailProvider: config.newsletterMailProvider,
    publicApiUrl: config.publicApiUrl,
    authSecret: config.authSecret,
  } satisfies ProcessingConfig;
  const now = Date.now();
  const candidates = await db.select().from(mailDeliveries).where(or(
    and(lt(mailDeliveries.attempts, MAX_ATTEMPTS), inArray(mailDeliveries.status, ["pending", "retry"]), lte(mailDeliveries.nextAttemptAt, now)),
    and(eq(mailDeliveries.status, "processing"), isNotNull(mailDeliveries.leaseExpiresAt), lte(mailDeliveries.leaseExpiresAt, now)),
  )).limit(20).all();
  let processed = 0;
  let sent = 0;
  for (const candidate of candidates) {
    if (candidate.attempts >= MAX_ATTEMPTS) {
      if (await terminalizeExhaustedLease(db, candidate, now)) processed += 1;
      continue;
    }
    const claimed = await claimDelivery(db, candidate, now);
    if (!claimed) continue;
    processed += 1;
    diagnosticInfo({ event: "newsletter.delivery.claimed", issueId: claimed.issueId, attempt: claimed.attempts });
    if (await processDelivery(db, processingConfig, claimed)) sent += 1;
  }
  diagnosticInfo({ event: "newsletter.batch.completed", processed, sent });
  return { kind: "processed", processed, sent };
}

export function newsletterRoutes(db: DB, config: AppConfig) {
  const routes = new Hono();
  routes.post("/issues", async (context) => {
    if (!authorized(config, context.req.header("x-job-secret"))) return fail(context, 401, "JOB_AUTH_REQUIRED", "未授权任务");
    if (!config.authSecret) return fail(context, 503, "AUTH_UNAVAILABLE", "认证服务未配置");
    const body = await context.req.json<{ date?: string; subject?: string; text?: string }>();
    if (!body.date?.match(/^\d{4}-\d{2}-\d{2}$/) || !body.subject || !body.text) return badInput(context, "发行参数非法");
    const id = crypto.randomUUID();
    const inserted = await db.insert(newsletterIssues).values({
      id, issueDate: body.date, subject: body.subject, textContent: body.text,
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
    switch (result.kind) {
      case "processed":
        return context.json({ ok: true, data: { processed: result.processed, sent: result.sent } });
      case "skipped":
        switch (result.reason) {
          case "provider_unavailable":
            return fail(context, 503, "MAIL_UNAVAILABLE", "摘要邮件服务未配置");
          case "public_url_unavailable":
            return fail(context, 503, "PUBLIC_URL_UNAVAILABLE", "未配置公开 API 地址");
          case "auth_unavailable":
            return fail(context, 503, "AUTH_UNAVAILABLE", "认证服务未配置");
        }
    }
  });
  return routes;
}
