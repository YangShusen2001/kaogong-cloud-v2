import { and, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { subscriptionSchema } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { mailDeliveries, subscriptions } from "../db/schema";
import { sha256 } from "../lib/auth";
import { badInput, fail } from "../lib/http";
import { deriveUnsubscribeToken, newsletterRoutes } from "../lib/newsletter";
import { sessionUserId } from "./auth";

async function changeSubscription(
  db: DB,
  userId: string,
  subscribed: boolean,
  tokenHash: string | null,
  tokenNonce: string | null,
  now: number,
): Promise<typeof subscriptions.$inferSelect | undefined> {
  const current = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
  if (!subscribed && current?.status === "suppressed") return current;
  const values = {
    status: subscribed ? "subscribed" : "unsubscribed",
    subscribedAt: subscribed ? now : null,
    unsubscribedAt: subscribed ? null : now,
    unsubscribeTokenHash: subscribed ? tokenHash : null,
    unsubscribeTokenNonce: subscribed ? tokenNonce : null,
    updatedAt: now,
  };
  const writeSubscription = (executor: DB) => executor.insert(subscriptions).values({ userId, ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values, setWhere: subscribed ? ne(subscriptions.status, "suppressed") : undefined });
  const cancelDeliveries = (executor: DB) => executor.update(mailDeliveries).set({
    status: "cancelled",
    leaseToken: null,
    leaseExpiresAt: null,
  }).where(and(
    eq(mailDeliveries.userId, userId),
    inArray(mailDeliveries.status, ["pending", "retry", "processing"]),
  ));

  if ("batch" in db) {
    if (subscribed) await db.batch([writeSubscription(db)]);
    else await db.batch([writeSubscription(db), cancelDeliveries(db)]);
    return (await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get()) ?? current;
  }
  db.transaction((transaction) => {
    writeSubscription(transaction).run();
    if (!subscribed) cancelDeliveries(transaction).run();
  });
  return (await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get()) ?? current;
}

export function subscriptionRoutes(db: DB, config: AppConfig) {
  const routes = new Hono();
  routes.get("/", async (context) => {
    const userId = await sessionUserId(context, db);
    if (!userId) return fail(context, 401, "AUTH_REQUIRED", "未登录");
    const row = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
    return context.json({ ok: true, data: {
      subscribed: row?.status === "subscribed",
      deliveryAvailable: Boolean(config.newsletterMailProvider),
      suppressionReason: row?.suppressionReason ?? null,
    } });
  });
  routes.post("/", async (context) => {
    const userId = await sessionUserId(context, db);
    if (!userId) return fail(context, 401, "AUTH_REQUIRED", "未登录");
    let raw: unknown = {};
    try { raw = await context.req.json(); } catch { raw = {}; }
    const parsed = subscriptionSchema.safeParse(raw);
    if (!parsed.success) return badInput(context, parsed.error.issues[0]?.message ?? "参数非法");
    const subscribed = parsed.data.subscribed;
    const current = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get();
    if (subscribed && current?.status === "suppressed") return fail(context, 409, "SUBSCRIPTION_SUPPRESSED", "该邮箱已被永久停止投递");
    if (subscribed && !config.newsletterMailProvider) return fail(context, 503, "MAIL_UNAVAILABLE", "摘要邮件服务未配置");
    if (subscribed && !config.authSecret) return fail(context, 503, "AUTH_UNAVAILABLE", "认证服务未配置");
    const tokenNonce = subscribed ? crypto.randomUUID() : null;
    const token = config.authSecret && tokenNonce
      ? await deriveUnsubscribeToken(userId, tokenNonce, config.authSecret)
      : null;
    const persisted = await changeSubscription(db, userId, subscribed, token ? await sha256(token) : null, tokenNonce, Date.now());
    if (!persisted) return fail(context, 500, "SUBSCRIPTION_PERSISTENCE_FAILED", "订阅状态保存失败");
    if (subscribed && persisted.status === "suppressed") return fail(context, 409, "SUBSCRIPTION_SUPPRESSED", "该邮箱已被永久停止投递");
    return context.json({ ok: true, data: { subscribed: persisted.status === "subscribed", deliveryAvailable: Boolean(config.newsletterMailProvider), suppressionReason: persisted.suppressionReason ?? null } });
  });
  routes.get("/unsubscribe", async (context) => {
    const token = context.req.query("token");
    if (!token) return badInput(context, "退订链接无效");
    const row = await db.select().from(subscriptions).where(eq(subscriptions.unsubscribeTokenHash, await sha256(token))).get();
    if (!row) return fail(context, 404, "UNSUBSCRIBE_INVALID", "退订链接无效或已失效");
    await changeSubscription(db, row.userId, false, null, null, Date.now());
    return context.text("已退订每日时政摘要。你可以登录个人中心重新订阅。");
  });
  return routes;
}

export { newsletterRoutes };
