import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "../app";
import { subscriptions } from "../db/schema";
import { sha256 } from "./auth";

export async function deriveUnsubscribeToken(userId: string, nonce: string, authSecret: string): Promise<string> {
  return sha256(`unsubscribe:${userId}:${nonce}:${authSecret}`);
}

export async function provisionUnsubscribeToken(db: DB, userId: string, authSecret: string): Promise<string | undefined> {
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
      unsubscribeTokenNonce: nonce, unsubscribeTokenHash: tokenHash, updatedAt: Date.now(),
    }).where(and(
      eq(subscriptions.userId, userId), eq(subscriptions.status, "subscribed"), observedNonce, observedHash,
    )).returning().all();
    if (updated.length === 1) return token;
    current = await db.select().from(subscriptions).where(and(
      eq(subscriptions.userId, userId), eq(subscriptions.status, "subscribed"),
    )).get();
  }
  return undefined;
}
