import { describe, expect, it } from "vitest";
import { mailDeliveries, newsletterIssues, resendWebhookEvents, subscriptions } from "../src/db/schema";
import { makeContext } from "./helpers";

const SECRET = "whsec_dGVzdC13ZWJob29rLXNlY3JldA==";

async function signedHeaders(body: string, id: string, timestamp: number): Promise<Record<string, string>> {
  const key = Uint8Array.from(atob(SECRET.slice(6)), (character) => character.charCodeAt(0));
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${encoded}`, "content-type": "application/json" };
}

describe("Resend webhook", () => {
  it("returns unavailable when webhook signing is not configured", async () => {
    // Given
    const context = makeContext();

    // When
    const response = await context.app.request("/api/webhooks/resend", { method: "POST", body: "{}" });

    // Then
    expect(response.status).toBe(503);
  });

  it("rejects an invalid signature before parsing JSON", async () => {
    // Given
    const context = makeContext({ resendWebhookSecret: SECRET });

    // When
    const response = await context.app.request("/api/webhooks/resend", { method: "POST", body: "not-json", headers: {
      "svix-id": "msg_invalid", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,bad",
    } });

    // Then
    expect(response.status).toBe(401);
  });

  it("deduplicates a signed event and suppresses a permanent bounce without storing recipient", async () => {
    // Given
    const context = makeContext({ resendWebhookSecret: SECRET });
    await context.db.insert(subscriptions).values({ userId: "user-1", status: "subscribed", updatedAt: 1 }).run();
    await context.db.insert(mailDeliveries).values({
      id: "delivery-1", issueId: "issue-1", userId: "user-1", recipient: "private@example.com", status: "processing",
      attempts: 1, lastError: "", nextAttemptAt: 0, providerMessageId: "provider-1", createdAt: 1,
    }).run();
    const body = JSON.stringify({
      type: "email.bounced", created_at: "2026-08-15T00:00:00.000Z",
      data: { email_id: "provider-1", to: ["private@example.com"], bounce: { type: "Permanent" } },
    });
    const headers = await signedHeaders(body, "msg_1", Math.floor(Date.now() / 1000));

    // When
    const first = await context.app.request("/api/webhooks/resend", { method: "POST", body, headers });
    const duplicate = await context.app.request("/api/webhooks/resend", { method: "POST", body, headers });

    // Then
    expect([first.status, duplicate.status]).toEqual([204, 204]);
    expect(await context.db.select().from(resendWebhookEvents).all()).toEqual([expect.objectContaining({ svixId: "msg_1", providerMessageId: "provider-1" })]);
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ status: "suppressed", suppressionReason: "permanent_bounce" });
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "cancelled", providerEvent: "bounced" });
    expect(JSON.stringify(await context.db.select().from(resendWebhookEvents).all())).not.toContain("private@example.com");
  });

  it("replays a complaint that arrives before the provider message ID is persisted", async () => {
    // Given
    const context = makeContext({
      authSecret: "secret", jobSecret: "job", publicApiUrl: "https://api.example.com", resendWebhookSecret: SECRET,
      newsletterMailProvider: {
        async send() {
          const body = JSON.stringify({ type: "email.complained", created_at: "2026-08-15T00:00:00.000Z", data: { email_id: "provider-race" } });
          const headers = await signedHeaders(body, "msg_race", Math.floor(Date.now() / 1000));
          expect((await context.app.request("/api/webhooks/resend", { method: "POST", body, headers })).status).toBe(204);
          return { kind: "accepted", providerMessageId: "provider-race" };
        },
        async reconcile() { return { kind: "found", event: "sent" }; },
      },
    });
    await context.db.insert(subscriptions).values({ userId: "user-1", status: "subscribed", updatedAt: 1 }).run();
    await context.db.insert(newsletterIssues).values({ id: "issue-1", issueDate: "2026-08-15", subject: "Brief", textContent: "Body", status: "published", createdAt: 1 }).run();
    await context.db.insert(mailDeliveries).values({
      id: "delivery-1", issueId: "issue-1", userId: "user-1", recipient: "private@example.com",
      status: "pending", attempts: 0, lastError: "", nextAttemptAt: 0, createdAt: 1,
    }).run();

    // When
    const response = await context.app.request("/api/newsletter/process", { method: "POST", headers: { "x-job-secret": "job" } });

    // Then
    expect(response.status).toBe(200);
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ status: "suppressed", suppressionReason: "complaint" });
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "cancelled", providerEvent: "complained" });
  });

  it("does not regress a delivered status when an older sent event arrives", async () => {
    // Given
    const context = makeContext({ resendWebhookSecret: SECRET });
    await context.db.insert(mailDeliveries).values({
      id: "delivery-1", issueId: "issue-1", userId: "user-1", recipient: "private@example.com", status: "sent",
      attempts: 1, lastError: "", nextAttemptAt: 0, providerMessageId: "provider-1", providerEvent: "delivered",
      providerEventAt: Date.parse("2026-08-15T01:00:00.000Z"), createdAt: 1,
    }).run();
    const body = JSON.stringify({ type: "email.sent", created_at: "2026-08-15T00:00:00.000Z", data: { email_id: "provider-1" } });
    const headers = await signedHeaders(body, "msg_2", Math.floor(Date.now() / 1000));

    // When
    const response = await context.app.request("/api/webhooks/resend", { method: "POST", body, headers });

    // Then
    expect(response.status).toBe(204);
    expect((await context.db.select().from(mailDeliveries).get())?.providerEvent).toBe("delivered");
  });

  it("atomically preserves a newer delivered event across concurrent stale projection", async () => {
    // Given
    const context = makeContext({ resendWebhookSecret: SECRET });
    await context.db.insert(mailDeliveries).values({
      id: "delivery-1", issueId: "issue-1", userId: "user-1", recipient: "private@example.com", status: "processing",
      attempts: 1, lastError: "", nextAttemptAt: 0, providerMessageId: "provider-1", createdAt: 1,
    }).run();
    const deliveredBody = JSON.stringify({ type: "email.delivered", created_at: "2026-08-15T01:00:00.000Z", data: { email_id: "provider-1" } });
    const sentBody = JSON.stringify({ type: "email.sent", created_at: "2026-08-15T00:00:00.000Z", data: { email_id: "provider-1" } });
    const timestamp = Math.floor(Date.now() / 1000);

    // When
    const responses = await Promise.all([
      context.app.request("/api/webhooks/resend", { method: "POST", body: deliveredBody, headers: await signedHeaders(deliveredBody, "msg_delivered", timestamp) }),
      context.app.request("/api/webhooks/resend", { method: "POST", body: sentBody, headers: await signedHeaders(sentBody, "msg_stale_sent", timestamp) }),
    ]);

    // Then
    expect(responses.map((response) => response.status)).toEqual([204, 204]);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({
      status: "sent", providerEvent: "delivered", providerEventAt: Date.parse("2026-08-15T01:00:00.000Z"),
    });
  });

  it("replays a delivered event without downgrading it to sent after provider ID persistence", async () => {
    // Given
    const context = makeContext({
      authSecret: "secret", jobSecret: "job", publicApiUrl: "https://api.example.com", resendWebhookSecret: SECRET,
      newsletterMailProvider: {
        async send() {
          const body = JSON.stringify({ type: "email.delivered", created_at: "2026-08-15T01:00:00.000Z", data: { email_id: "provider-delivered" } });
          const headers = await signedHeaders(body, "msg_early_delivered", Math.floor(Date.now() / 1000));
          expect((await context.app.request("/api/webhooks/resend", { method: "POST", body, headers })).status).toBe(204);
          return { kind: "accepted", providerMessageId: "provider-delivered" };
        },
        async reconcile() { return { kind: "found", event: "delivered" }; },
      },
    });
    await context.db.insert(subscriptions).values({ userId: "user-1", status: "subscribed", updatedAt: 1 }).run();
    await context.db.insert(newsletterIssues).values({ id: "issue-1", issueDate: "2026-08-15", subject: "Brief", textContent: "Body", status: "published", createdAt: 1 }).run();
    await context.db.insert(mailDeliveries).values({
      id: "delivery-1", issueId: "issue-1", userId: "user-1", recipient: "private@example.com",
      status: "pending", attempts: 0, lastError: "", nextAttemptAt: 0, createdAt: 1,
    }).run();

    // When
    const response = await context.app.request("/api/newsletter/process", { method: "POST", headers: { "x-job-secret": "job" } });

    // Then
    expect(response.status).toBe(200);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "sent", providerEvent: "delivered" });
  });

  it("suppresses a recipient without replacing newer delivery metadata", async () => {
    // Given
    const context = makeContext({ resendWebhookSecret: SECRET });
    await context.db.insert(subscriptions).values({ userId: "user-1", status: "subscribed", updatedAt: 1 }).run();
    await context.db.insert(mailDeliveries).values({
      id: "delivery-1", issueId: "issue-1", userId: "user-1", recipient: "private@example.com", status: "sent",
      attempts: 1, lastError: "", nextAttemptAt: 0, providerMessageId: "provider-1", providerEvent: "delivered",
      providerEventAt: Date.parse("2026-08-15T01:00:00.000Z"), createdAt: 1,
    }).run();
    const body = JSON.stringify({ type: "email.complained", created_at: "2026-08-15T00:00:00.000Z", data: { email_id: "provider-1" } });
    const headers = await signedHeaders(body, "msg_older_complaint", Math.floor(Date.now() / 1000));

    // When
    const response = await context.app.request("/api/webhooks/resend", { method: "POST", body, headers });

    // Then
    expect(response.status).toBe(204);
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ status: "suppressed", suppressionReason: "complaint" });
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "cancelled", providerEvent: "delivered" });
  });

  it("acknowledges a signed unsupported event and rejects malformed known events", async () => {
    // Given
    const context = makeContext({ resendWebhookSecret: SECRET });
    const timestamp = Math.floor(Date.now() / 1000);
    const unsupportedBody = JSON.stringify({ type: "domain.created", created_at: "2026-08-15T00:00:00.000Z", data: {} });
    const malformedBody = JSON.stringify({ type: "email.sent", created_at: "invalid", data: {} });

    // When
    const unsupported = await context.app.request("/api/webhooks/resend", {
      method: "POST", body: unsupportedBody, headers: await signedHeaders(unsupportedBody, "msg_unsupported", timestamp),
    });
    const malformed = await context.app.request("/api/webhooks/resend", {
      method: "POST", body: malformedBody, headers: await signedHeaders(malformedBody, "msg_malformed", timestamp),
    });

    // Then
    expect(unsupported.status).toBe(204);
    expect(malformed.status).toBe(400);
  });
});
