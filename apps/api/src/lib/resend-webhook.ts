import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../app";
import { mailDeliveries, resendWebhookEvents, subscriptions } from "../db/schema";

const eventTypeSchema = z.enum([
  "email.sent", "email.delivered", "email.delivery_delayed", "email.failed",
  "email.bounced", "email.complained", "email.suppressed",
]);
const providerEventSchema = z.enum([
  "sent", "delivered", "delivery_delayed", "failed", "bounced", "complained", "suppressed",
]);
const webhookSchema = z.object({
  type: eventTypeSchema,
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().min(1),
    bounce: z.object({ type: z.string() }).optional(),
  }).passthrough(),
});

export type ResendWebhookEvent = z.infer<typeof webhookSchema>;
export type ResendWebhookParseResult =
  | { readonly kind: "known"; readonly event: ResendWebhookEvent }
  | { readonly kind: "unsupported" }
  | { readonly kind: "malformed" };
const RANK = {
  sent: 1, delivery_delayed: 2, delivered: 3, failed: 4, bounced: 5, complained: 6, suppressed: 7,
} as const;
type StoredWebhookEvent = typeof resendWebhookEvents.$inferSelect;
type ProviderEventProjection = {
  readonly deliveryId: string;
  readonly userId: string;
  readonly providerMessageId: string;
  readonly leaseToken?: string;
  readonly providerEvent: keyof typeof RANK;
  readonly eventAt: number;
  readonly suppressionReason?: string;
  readonly now: number;
};

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch (error) {
    if (error instanceof Error) return undefined;
    throw error;
  }
}

async function matchesSignature(secret: string, signed: string, signature: string): Promise<boolean> {
  if (!secret.startsWith("whsec_")) return false;
  const keyBytes = decodeBase64(secret.slice(6));
  if (!keyBytes) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const candidate of signature.split(" ")) {
    const encoded = candidate.startsWith("v1,") ? candidate.slice(3) : undefined;
    const bytes = encoded ? decodeBase64(encoded) : undefined;
    if (bytes && await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(signed))) return true;
  }
  return false;
}

export async function verifyResendWebhook(input: {
  readonly body: string;
  readonly svixId: string | undefined;
  readonly svixTimestamp: string | undefined;
  readonly svixSignature: string | undefined;
  readonly secret: string;
  readonly now: number;
}): Promise<boolean> {
  if (!input.svixId || !input.svixTimestamp || !input.svixSignature) return false;
  const timestamp = z.coerce.number().int().safeParse(input.svixTimestamp);
  if (!timestamp.success || Math.abs(Math.floor(input.now / 1000) - timestamp.data) > 300) return false;
  return matchesSignature(input.secret, `${input.svixId}.${input.svixTimestamp}.${input.body}`, input.svixSignature);
}

export function parseResendWebhook(body: string): ResendWebhookParseResult {
  try {
    const raw = JSON.parse(body);
    const envelope = z.object({ type: z.string() }).safeParse(raw);
    if (!envelope.success) return { kind: "malformed" };
    if (!eventTypeSchema.safeParse(envelope.data.type).success) return { kind: "unsupported" };
    const parsed = webhookSchema.safeParse(raw);
    return parsed.success ? { kind: "known", event: parsed.data } : { kind: "malformed" };
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "malformed" };
    throw error;
  }
}

function eventName(type: ResendWebhookEvent["type"]): keyof typeof RANK {
  const names = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "delivery_delayed",
    "email.failed": "failed",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.suppressed": "suppressed",
  } as const;
  return names[type];
}

function suppressionReason(event: ResendWebhookEvent): string | undefined {
  if (event.type === "email.complained") return "complaint";
  if (event.type === "email.suppressed") return "provider_suppressed";
  if (event.type === "email.bounced" && event.data.bounce?.type.toLowerCase() === "permanent") return "permanent_bounce";
  return undefined;
}

export async function applyNewsletterProviderEvent(db: DB, projection: ProviderEventProjection): Promise<boolean> {
  const status = projection.providerEvent === "failed" || projection.providerEvent === "bounced"
    || projection.providerEvent === "complained" || projection.providerEvent === "suppressed" ? "failed" : "sent";
  const currentRank = sql<number>`case ${mailDeliveries.providerEvent}
    when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 when 'failed' then 4
    when 'bounced' then 5 when 'complained' then 6 when 'suppressed' then 7 else 0 end`;
  const projected = await db.update(mailDeliveries).set({
    providerEvent: projection.providerEvent, providerEventAt: projection.eventAt, status,
  }).where(and(
    eq(mailDeliveries.id, projection.deliveryId),
    eq(mailDeliveries.providerMessageId, projection.providerMessageId),
    projection.leaseToken ? eq(mailDeliveries.leaseToken, projection.leaseToken) : sql`1 = 1`,
    sql`${mailDeliveries.status} <> 'cancelled'`,
    or(isNull(mailDeliveries.providerEventAt), lte(mailDeliveries.providerEventAt, projection.eventAt)),
    lte(currentRank, RANK[projection.providerEvent]),
  )).returning().all();
  if (projection.leaseToken && projected.length !== 1) return false;
  if (!projection.suppressionReason) return projected.length === 1;
  const suppress = (executor: DB) => executor.update(subscriptions).set({
    status: "suppressed", suppressionReason: projection.suppressionReason, suppressedAt: projection.eventAt,
    suppressionProviderMessageId: projection.providerMessageId,
    unsubscribeTokenHash: null, unsubscribeTokenNonce: null, updatedAt: projection.now,
  }).where(eq(subscriptions.userId, projection.userId));
  const cancel = (executor: DB) => executor.update(mailDeliveries).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null })
    .where(and(eq(mailDeliveries.userId, projection.userId), inArray(mailDeliveries.status, ["pending", "retry", "processing"])));
  const cancelCurrent = (executor: DB) => executor.update(mailDeliveries).set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null })
    .where(eq(mailDeliveries.id, projection.deliveryId));
  if ("batch" in db) await db.batch([suppress(db), cancel(db), cancelCurrent(db)]);
  else db.transaction((transaction) => {
    suppress(transaction).run();
    cancel(transaction).run();
    cancelCurrent(transaction).run();
  });
  return true;
}

export async function applyPendingResendWebhookEvents(db: DB, providerMessageId: string, now: number): Promise<void> {
  const events = await db.select().from(resendWebhookEvents).where(eq(resendWebhookEvents.providerMessageId, providerMessageId))
    .orderBy(asc(resendWebhookEvents.eventAt)).all();
  for (const event of events) {
    const delivery = await db.select().from(mailDeliveries).where(eq(mailDeliveries.providerMessageId, providerMessageId)).get();
    if (!delivery) return;
    const parsedType = eventTypeSchema.safeParse(event.eventType);
    if (!parsedType.success) continue;
      await applyNewsletterProviderEvent(db, {
      deliveryId: delivery.id, userId: delivery.userId, providerMessageId,
      providerEvent: eventName(parsedType.data), eventAt: event.eventAt,
      suppressionReason: event.suppressionReason ?? undefined, now,
    });
  }
}

export async function processResendWebhook(db: DB, svixId: string, event: ResendWebhookEvent, now: number): Promise<void> {
  await db.insert(resendWebhookEvents).values({
    svixId, providerMessageId: event.data.email_id, eventType: event.type,
    suppressionReason: suppressionReason(event), eventAt: Date.parse(event.created_at), processedAt: now,
  }).onConflictDoNothing().run();
  await applyPendingResendWebhookEvents(db, event.data.email_id, now);
}
