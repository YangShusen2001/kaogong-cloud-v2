import { Hono } from "hono";
import type { AppConfig, DB } from "../app";
import { parseResendWebhook, processResendWebhook, verifyResendWebhook } from "../lib/resend-webhook";

export function webhookRoutes(db: DB, config: AppConfig) {
  const routes = new Hono();
  routes.post("/resend", async (context) => {
    if (!config.resendWebhookSecret) return context.body(null, 503);
    const body = await context.req.text();
    const svixId = context.req.header("svix-id");
    const valid = await verifyResendWebhook({
      body,
      svixId,
      svixTimestamp: context.req.header("svix-timestamp"),
      svixSignature: context.req.header("svix-signature"),
      secret: config.resendWebhookSecret,
      now: Date.now(),
    });
    if (!valid) return context.body(null, 401);
    const parsed = parseResendWebhook(body);
    if (parsed.kind === "unsupported") return context.body(null, 204);
    if (parsed.kind === "malformed" || !svixId) return context.body(null, 400);
    await processResendWebhook(db, svixId, parsed.event, Date.now());
    return context.body(null, 204);
  });
  return routes;
}
