import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { AppConfig, DB } from "../app";
import { mailDeliveries, newsletterIssues, subscriptions } from "../db/schema";
import { diagnosticInfo, diagnosticWarn } from "./diagnostics";
import type { NewsletterProviderEvent, NewsletterSendResult } from "./newsletter-mail-provider";
import { provisionUnsubscribeToken } from "./newsletter-token";
import { applyNewsletterProviderEvent, applyPendingResendWebhookEvents } from "./resend-webhook";

const MAX_ATTEMPTS = 3;
const MAX_RECONCILE_ATTEMPTS = 5;
const LEASE_DURATION = 5 * 60_000;

type Delivery = typeof mailDeliveries.$inferSelect;
type ClaimedDelivery = Delivery & { readonly leaseToken: string };
type ProcessingConfig = {
  readonly newsletterMailProvider: NonNullable<AppConfig["newsletterMailProvider"]>;
  readonly publicApiUrl: string;
  readonly authSecret: string;
};

export type NewsletterBatchResult =
  | { readonly kind: "processed"; readonly processed: number; readonly sent: number }
  | { readonly kind: "skipped"; readonly reason: "provider_unavailable" | "public_url_unavailable" | "auth_unavailable" };

async function claimDelivery(db: DB, delivery: Delivery, now: number): Promise<ClaimedDelivery | undefined> {
  const leaseToken = crypto.randomUUID();
  const observed = delivery.status === "processing"
    ? and(eq(mailDeliveries.status, "processing"),
      delivery.leaseToken === null ? isNull(mailDeliveries.leaseToken) : eq(mailDeliveries.leaseToken, delivery.leaseToken),
      delivery.leaseExpiresAt === null ? isNull(mailDeliveries.leaseExpiresAt) : eq(mailDeliveries.leaseExpiresAt, delivery.leaseExpiresAt))
    : delivery.status === "outcome_unknown"
      ? and(eq(mailDeliveries.status, "outcome_unknown"), eq(mailDeliveries.nextReconcileAt, delivery.nextReconcileAt), lte(mailDeliveries.nextReconcileAt, now))
      : and(eq(mailDeliveries.status, delivery.status), eq(mailDeliveries.nextAttemptAt, delivery.nextAttemptAt), lte(mailDeliveries.nextAttemptAt, now));
  const claimed = await db.update(mailDeliveries).set({
    status: "processing", attempts: delivery.providerMessageId ? delivery.attempts : sql`${mailDeliveries.attempts} + 1`, leaseToken, leaseExpiresAt: now + LEASE_DURATION,
  }).where(and(eq(mailDeliveries.id, delivery.id), or(lt(mailDeliveries.attempts, MAX_ATTEMPTS), isNotNull(mailDeliveries.providerMessageId)), observed)).returning().all();
  const row = claimed[0];
  return row ? { ...row, leaseToken } : undefined;
}

async function finalizeSent(db: DB, delivery: ClaimedDelivery, providerMessageId: string, event: NewsletterProviderEvent): Promise<boolean> {
  const owner = and(eq(mailDeliveries.id, delivery.id), eq(mailDeliveries.leaseToken, delivery.leaseToken));
  const identified = await db.update(mailDeliveries).set({ providerMessageId }).where(and(
    owner,
    or(isNull(mailDeliveries.providerMessageId), eq(mailDeliveries.providerMessageId, providerMessageId)),
  )).returning().all();
  if (identified.length !== 1) return false;
  await applyPendingResendWebhookEvents(db, providerMessageId, Date.now());
  await applyNewsletterProviderEvent(db, {
    deliveryId: delivery.id, userId: delivery.userId, providerMessageId, providerEvent: event,
    leaseToken: delivery.leaseToken,
    eventAt: Date.now(), now: Date.now(),
  });
  const finalized = await db.update(mailDeliveries).set({
    sentAt: Date.now(), lastError: "", nextAttemptAt: 0, leaseToken: null, leaseExpiresAt: null,
    lastReconciledAt: Date.now(), nextReconcileAt: 0,
  }).where(and(owner, eq(mailDeliveries.providerMessageId, providerMessageId), eq(mailDeliveries.status, "sent"))).returning().all();
  return finalized.length === 1;
}

async function finishFailure(db: DB, delivery: ClaimedDelivery, result: Exclude<NewsletterSendResult, { readonly kind: "accepted" }>): Promise<boolean> {
  const terminal = result.kind === "permanent" || delivery.attempts >= MAX_ATTEMPTS;
  const status = terminal && (result.kind === "outcome_unknown" || Boolean(delivery.providerMessageId))
    ? "outcome_unknown" : terminal ? "failed" : "retry";
  const finalized = await db.update(mailDeliveries).set({
    status, nextAttemptAt: terminal ? 0 : Date.now() + 60_000 * 2 ** (delivery.attempts - 1),
    lastError: "provider_error", leaseToken: null, leaseExpiresAt: null,
  }).where(and(eq(mailDeliveries.id, delivery.id), eq(mailDeliveries.leaseToken, delivery.leaseToken))).returning().all();
  if (finalized.length === 1) diagnosticWarn({ event: status === "retry" ? "newsletter.delivery.retry" : "newsletter.delivery.failed", issueId: delivery.issueId, attempt: delivery.attempts });
  return false;
}

async function reconcileKnown(db: DB, config: ProcessingConfig, delivery: ClaimedDelivery): Promise<boolean> {
  const providerMessageId = delivery.providerMessageId;
  if (!providerMessageId) return false;
  const owner = and(eq(mailDeliveries.id, delivery.id), eq(mailDeliveries.leaseToken, delivery.leaseToken));
  const reconcileAttempts = delivery.reconcileAttempts + 1;
  let result: Awaited<ReturnType<ProcessingConfig["newsletterMailProvider"]["reconcile"]>>;
  try {
    result = await config.newsletterMailProvider.reconcile(providerMessageId);
  } catch (error) {
    await db.update(mailDeliveries).set({
      status: "outcome_unknown", reconcileAttempts, lastReconciledAt: Date.now(),
      nextReconcileAt: reconcileAttempts >= MAX_RECONCILE_ATTEMPTS ? 0 : Date.now() + 60_000 * 2 ** (reconcileAttempts - 1),
      leaseToken: null, leaseExpiresAt: null,
    }).where(owner).run();
    return false;
  }
  switch (result.kind) {
    case "found":
      if (result.event === "sent" || result.event === "delivered" || result.event === "delivery_delayed") {
        await db.update(mailDeliveries).set({ reconcileAttempts, lastReconciledAt: Date.now() }).where(owner).run();
        return finalizeSent(db, delivery, providerMessageId, result.event);
      }
      await db.update(mailDeliveries).set({ reconcileAttempts, lastReconciledAt: Date.now() }).where(owner).run();
      await applyNewsletterProviderEvent(db, {
        deliveryId: delivery.id, userId: delivery.userId, providerMessageId, providerEvent: result.event,
        leaseToken: delivery.leaseToken,
        eventAt: Date.now(), suppressionReason: result.event === "complained" ? "complaint"
          : result.event === "suppressed" ? "provider_suppressed" : undefined, now: Date.now(),
      });
      await db.update(mailDeliveries).set({ nextReconcileAt: 0, leaseToken: null, leaseExpiresAt: null }).where(owner).run();
      return false;
    case "not_found":
    case "permanent":
    case "outcome_unknown":
    case "retryable":
      await db.update(mailDeliveries).set({
        status: "outcome_unknown", reconcileAttempts, lastReconciledAt: Date.now(),
        nextReconcileAt: reconcileAttempts >= MAX_RECONCILE_ATTEMPTS ? 0 : Date.now() + 60_000 * 2 ** (reconcileAttempts - 1),
        leaseToken: null, leaseExpiresAt: null,
      }).where(owner).run();
      return false;
  }
}

async function processDelivery(db: DB, config: ProcessingConfig, delivery: ClaimedDelivery): Promise<boolean> {
  if (delivery.providerMessageId) return reconcileKnown(db, config, delivery);
  const issue = await db.select().from(newsletterIssues).where(eq(newsletterIssues.id, delivery.issueId)).get();
  const active = await db.select().from(subscriptions).where(and(eq(subscriptions.userId, delivery.userId), eq(subscriptions.status, "subscribed"))).get();
  const owner = and(eq(mailDeliveries.id, delivery.id), eq(mailDeliveries.leaseToken, delivery.leaseToken));
  if (!issue || !active) {
    await db.update(mailDeliveries).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null }).where(owner).run();
    return false;
  }
  const unsubscribeToken = await provisionUnsubscribeToken(db, delivery.userId, config.authSecret);
  if (!unsubscribeToken) {
    await db.update(mailDeliveries).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null }).where(owner).run();
    return false;
  }
  const unsubscribeUrl = `${config.publicApiUrl.replace(/\/$/, "")}/api/subscription/unsubscribe?token=${unsubscribeToken}`;
  let result: NewsletterSendResult;
  try {
    result = await config.newsletterMailProvider.send({
      to: delivery.recipient, subject: issue.subject, text: `${issue.textContent}\n\n退订：${unsubscribeUrl}`, idempotencyKey: delivery.id,
    });
  } catch (error) {
    return finishFailure(db, delivery, { kind: "retryable", reason: "provider_unavailable" });
  }
  switch (result.kind) {
    case "accepted":
      return finalizeSent(db, delivery, result.providerMessageId, "sent");
    case "retryable":
    case "permanent":
    case "outcome_unknown":
      return finishFailure(db, delivery, result);
  }
}

export async function processNewsletterBatch(db: DB, config: AppConfig): Promise<NewsletterBatchResult> {
  if (!config.newsletterMailProvider) return { kind: "skipped", reason: "provider_unavailable" };
  if (!config.publicApiUrl) return { kind: "skipped", reason: "public_url_unavailable" };
  if (!config.authSecret) return { kind: "skipped", reason: "auth_unavailable" };
  const processingConfig = { newsletterMailProvider: config.newsletterMailProvider, publicApiUrl: config.publicApiUrl, authSecret: config.authSecret };
  const now = Date.now();
  const candidates = await db.select().from(mailDeliveries).where(or(
    and(lt(mailDeliveries.attempts, MAX_ATTEMPTS), inArray(mailDeliveries.status, ["pending", "retry"]), lte(mailDeliveries.nextAttemptAt, now)),
    and(eq(mailDeliveries.status, "processing"), isNotNull(mailDeliveries.leaseExpiresAt), lte(mailDeliveries.leaseExpiresAt, now),
      or(isNull(mailDeliveries.providerMessageId), lt(mailDeliveries.reconcileAttempts, MAX_RECONCILE_ATTEMPTS))),
    and(eq(mailDeliveries.status, "outcome_unknown"), isNotNull(mailDeliveries.providerMessageId),
      lt(mailDeliveries.reconcileAttempts, MAX_RECONCILE_ATTEMPTS), lte(mailDeliveries.nextReconcileAt, now)),
  )).limit(20).all();
  let processed = 0;
  let sent = 0;
  for (const candidate of candidates) {
    if (candidate.attempts >= MAX_ATTEMPTS && !candidate.providerMessageId) {
      await db.update(mailDeliveries).set({ status: "outcome_unknown", lastError: "lease_expired", leaseToken: null, leaseExpiresAt: null })
        .where(and(eq(mailDeliveries.id, candidate.id), candidate.leaseToken === null ? isNull(mailDeliveries.leaseToken) : eq(mailDeliveries.leaseToken, candidate.leaseToken))).run();
      processed += 1;
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
