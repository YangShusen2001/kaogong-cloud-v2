import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mailDeliveries, newsletterIssues, sessions, subscriptions, users } from "../src/db/schema";
import { createApp } from "../src/app";
import { makeContext, readJson } from "./helpers";
import { authenticatedContext, createIssue, ISSUE, processBatch, provider, setSubscription } from "./newsletter-test-helpers";

const NOW = new Date("2026-08-15T00:00:00.000Z");

describe("newsletter reliability", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reports delivery availability and rejects subscribe without a provider", async () => {
    const { app, cookie } = await authenticatedContext();
    const available = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });

    const state = await app.request("/api/subscription", { headers: { cookie } });
    const availableState = await available.app.request("/api/subscription", { headers: { cookie: available.cookie } });
    const subscribe = await setSubscription(app, cookie, true);

    expect((await readJson<{ subscribed: boolean; deliveryAvailable: boolean; suppressionReason: string | null }>(state)).data).toEqual({ subscribed: false, deliveryAvailable: false, suppressionReason: null });
    expect((await readJson<{ deliveryAvailable: boolean }>(availableState)).data.deliveryAvailable).toBe(true);
    expect(subscribe.status).toBe(503);
  });

  it("allows unsubscribe without provider or auth secret", async () => {
    const context = await authenticatedContext();
    const appWithoutServices = createApp(context.db);

    const response = await setSubscription(appWithoutServices, context.cookie, false);

    expect(response.status).toBe(200);
  });

  it("blocks resubscribe after provider suppression and keeps suppression on unsubscribe", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => undefined) });
    await context.db.insert(subscriptions).values({
      userId: (await context.db.select().from(users).get())?.id ?? "missing",
      status: "suppressed", suppressionReason: "complaint", suppressedAt: Date.now(), updatedAt: Date.now(),
    }).onConflictDoUpdate({ target: subscriptions.userId, set: { status: "suppressed", suppressionReason: "complaint", suppressedAt: Date.now() } }).run();

    // When
    const resubscribe = await setSubscription(context.app, context.cookie, true);
    const unsubscribe = await setSubscription(context.app, context.cookie, false);

    // Then
    expect(resubscribe.status).toBe(409);
    expect(unsubscribe.status).toBe(200);
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ suppressionReason: "complaint", suppressedAt: Date.now() });
  });

  it("keeps suppression when subscribe races with terminal provider suppression", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "race-provider" }; },
      async reconcile() { return { kind: "found", event: "complained" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "race-provider", nextReconcileAt: Date.now(),
    }).run();

    // When
    await Promise.all([
      setSubscription(context.app, context.cookie, true),
      processBatch(context.app),
    ]);

    // Then
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({
      status: "suppressed", suppressionReason: "complaint", unsubscribeTokenHash: null,
    });
  });

  it("returns suppression conflict when subscribe loses to terminal provider suppression", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "response-race-provider" }; },
      async reconcile() { return { kind: "found", event: "complained" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "response-race-provider", nextReconcileAt: Date.now(),
    }).run();

    // When
    const [subscribeResponse] = await Promise.all([
      setSubscription(context.app, context.cookie, true),
      processBatch(context.app),
    ]);

    // Then
    expect(subscribeResponse?.status).toBe(409);
    expect((await readJson<never>(subscribeResponse as Response)).error).toMatchObject({ code: "SUBSCRIPTION_SUPPRESSED" });
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ status: "suppressed", suppressionReason: "complaint" });
  });

  it("requires auth secret for subscribing even when delivery exists", async () => {
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });
    const noSecret = makeContext({ newsletterMailProvider: provider(async () => ({})) });
    const sessionRows = await context.db.query.sessions.findMany();
    const userRows = await context.db.query.users.findMany();
    for (const user of userRows) await noSecret.db.insert(users).values(user).run();
    for (const session of sessionRows) await noSecret.db.insert(sessions).values(session).run();

    const response = await setSubscription(noSecret.app, context.cookie, true);

    expect(response.status).toBe(503);
  });

  it("requires the job secret for issue creation and processing", async () => {
    const { app } = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });

    const issue = await app.request("/api/newsletter/issues", { method: "POST", body: JSON.stringify(ISSUE), headers: { "content-type": "application/json" } });
    const process = await app.request("/api/newsletter/process", { method: "POST" });

    expect(issue.status).toBe(401);
    expect(process.status).toBe(401);
  });

  it("creates duplicate issues idempotently and never resends a successful delivery", async () => {
    const sent: string[] = [];
    const { app, db, cookie } = await authenticatedContext({ newsletterMailProvider: provider(async (message) => { sent.push(message.to); return {}; }) });
    await setSubscription(app, cookie, true);

    const [first, second] = await Promise.all([createIssue(app), createIssue(app)]);
    await processBatch(app);
    await processBatch(app);

    expect((await readJson<{ issueId: string }>(first)).data.issueId).toBe((await readJson<{ issueId: string }>(second)).data.issueId);
    expect(await db.select().from(newsletterIssues).all()).toHaveLength(1);
    expect(await db.select().from(mailDeliveries).all()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect((await db.select().from(mailDeliveries).get())?.providerMessageId).toBeTruthy();
  });

  it("reconciles an expired provider-known delivery without another POST", async () => {
    // Given
    let sends = 0;
    let reconciles = 0;
    const newsletterMailProvider = {
      async send() { sends += 1; return { kind: "accepted", providerMessageId: "provider-known" } as const; },
      async reconcile() { reconciles += 1; return { kind: "found", event: "delivered" } as const; },
    };
    const context = await authenticatedContext({ newsletterMailProvider });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "processing", attempts: 2, leaseToken: "expired", leaseExpiresAt: Date.now() - 1,
      providerMessageId: "provider-known",
    }).run();

    // When
    await processBatch(context.app);

    // Then
    expect(sends).toBe(0);
    expect(reconciles).toBe(1);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "sent", providerEvent: "delivered" });
  });

  it("reconciles a due provider-known unknown outcome without another POST", async () => {
    // Given
    let sends = 0;
    let reconciles = 0;
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { sends += 1; return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { reconciles += 1; return { kind: "found", event: "delivered" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", attempts: 3, providerMessageId: "provider-known", reconcileAttempts: 1,
      nextReconcileAt: Date.now(),
    }).run();

    // When
    await processBatch(context.app);

    // Then
    expect(sends).toBe(0);
    expect(reconciles).toBe(1);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({
      status: "sent", attempts: 3, reconcileAttempts: 2, nextReconcileAt: 0,
    });
  });

  it("backs off bounded reconciliation and leaves unknown rows without provider IDs untouched", async () => {
    // Given
    let sends = 0;
    let reconciles = 0;
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { sends += 1; return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { reconciles += 1; return { kind: "retryable" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    const existing = await context.db.select().from(mailDeliveries).get();
    if (!existing) throw new Error("delivery fixture missing");
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", reconcileAttempts: 2, nextReconcileAt: Date.now(),
    }).run();
    await context.db.insert(mailDeliveries).values({
      id: "unknown-without-provider", issueId: existing.issueId, userId: "other-user", recipient: "other@example.com",
      status: "outcome_unknown", attempts: 3, lastError: "provider_error", nextAttemptAt: 0, nextReconcileAt: 0, createdAt: 1,
    }).run();

    // When
    await processBatch(context.app);
    const afterFailure = await context.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, existing.id)).get();
    await processBatch(context.app);

    // Then
    expect(sends).toBe(0);
    expect(reconciles).toBe(1);
    expect(afterFailure).toMatchObject({ status: "outcome_unknown", attempts: 0, reconcileAttempts: 3 });
    expect(afterFailure?.nextReconcileAt).toBeGreaterThan(Date.now());
    expect(await context.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, "unknown-without-provider")).get()).toMatchObject({
      status: "outcome_unknown", reconcileAttempts: 0,
    });
  });

  it("leaves a provider-known unknown outcome terminal after the fifth reconciliation", async () => {
    // Given
    let reconciles = 0;
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { reconciles += 1; return { kind: "outcome_unknown" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", reconcileAttempts: 4, nextReconcileAt: Date.now(),
    }).run();

    // When
    await processBatch(context.app);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    await processBatch(context.app);

    // Then
    expect(reconciles).toBe(1);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({
      status: "outcome_unknown", reconcileAttempts: 5, nextReconcileAt: 0, leaseToken: null,
    });
  });

  it.each([
    ["complained", "complaint"],
    ["suppressed", "provider_suppressed"],
  ] as const)("durably suppresses a subscription when reconciliation finds %s", async (event, reason) => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { return { kind: "found", event }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    const delivery = await context.db.select().from(mailDeliveries).get();
    if (!delivery) throw new Error("delivery fixture missing");
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", nextReconcileAt: Date.now(),
    }).run();
    await context.db.insert(newsletterIssues).values({
      id: "next-issue", issueDate: "2026-08-16", subject: "Next brief", textContent: "Next body", status: "published", createdAt: 2,
    }).run();
    await context.db.insert(mailDeliveries).values({
      id: "open-delivery", issueId: "next-issue", userId: delivery.userId, recipient: delivery.recipient,
      status: "pending", attempts: 0, lastError: "", nextAttemptAt: 0, createdAt: 2,
    }).run();

    // When
    await processBatch(context.app);

    // Then
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({
      status: "suppressed", suppressionReason: reason, unsubscribeTokenHash: null, unsubscribeTokenNonce: null,
    });
    expect(await context.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, delivery.id)).get()).toMatchObject({
      status: "cancelled", providerEvent: event,
    });
    expect(await context.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, "open-delivery")).get()).toMatchObject({ status: "cancelled" });
  });

  it("records a reconciled bounce without inventing permanent suppression", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { return { kind: "found", event: "bounced" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", nextReconcileAt: Date.now(),
    }).run();

    // When
    await processBatch(context.app);

    // Then
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ status: "subscribed", suppressionReason: null });
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "failed", providerEvent: "bounced" });
  });

  it("backs off a provider not-found reconciliation instead of selecting it every schedule", async () => {
    // Given
    let reconciles = 0;
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { reconciles += 1; return { kind: "not_found" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", nextReconcileAt: Date.now(),
    }).run();

    // When
    await processBatch(context.app);
    const afterFirst = await context.db.select().from(mailDeliveries).get();
    await processBatch(context.app);

    // Then
    expect(reconciles).toBe(1);
    expect(afterFirst?.nextReconcileAt).toBeGreaterThan(Date.now());
  });

  it("contains a throwing send provider and safely releases the delivery lease", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { throw new Error("send exploded"); },
      async reconcile() { return { kind: "found", event: "sent" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    // When
    const response = await processBatch(context.app);

    // Then
    expect(response.status).toBe(200);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "retry", leaseToken: null, leaseExpiresAt: null });
  });

  it.each([
    ["a string", "send exploded"],
    ["an object", { reason: "send exploded" }],
  ] as const)("contains %s send provider rejection and safely releases the delivery lease", async (_label, rejection) => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { throw rejection; },
      async reconcile() { return { kind: "found", event: "sent" }; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    // When
    const response = await processBatch(context.app);

    // Then
    expect(response.status).toBe(200);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "retry", leaseToken: null, leaseExpiresAt: null });
  });

  it("contains a throwing reconcile provider and schedules a bounded retry", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { throw new Error("reconcile exploded"); },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", nextReconcileAt: Date.now(),
    }).run();

    // When
    const response = await processBatch(context.app);

    // Then
    expect(response.status).toBe(200);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({
      status: "outcome_unknown", reconcileAttempts: 1, leaseToken: null, leaseExpiresAt: null,
    });
    expect((await context.db.select().from(mailDeliveries).get())?.nextReconcileAt).toBeGreaterThan(Date.now());
  });

  it("does not suppress after reconciliation loses its lease before a complained result returns", async () => {
    // Given
    let releaseReconcile: (() => void) | undefined;
    let reconcileStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { reconcileStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseReconcile = resolve; });
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "stale-suppression-provider" }; },
      async reconcile() {
        reconcileStarted?.();
        await blocked;
        return { kind: "found", event: "complained" };
      },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    const delivery = await context.db.select().from(mailDeliveries).get();
    if (!delivery) throw new Error("delivery fixture missing");
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "stale-suppression-provider", nextReconcileAt: Date.now(),
    }).run();

    // When
    const staleWorker = processBatch(context.app);
    await started;
    await context.db.update(mailDeliveries).set({
      status: "processing", leaseToken: "new-owner", leaseExpiresAt: Date.now() + 60_000,
    }).where(eq(mailDeliveries.id, delivery.id)).run();
    releaseReconcile?.();
    await staleWorker;

    // Then
    expect(await context.db.select().from(subscriptions).get()).toMatchObject({ status: "subscribed", suppressionReason: null });
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "processing", leaseToken: "new-owner" });
  });

  it.each([
    ["a string", "reconcile exploded"],
    ["an object", { reason: "reconcile exploded" }],
  ] as const)("contains %s reconcile provider rejection and schedules a bounded retry", async (_label, rejection) => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: {
      async send() { return { kind: "accepted", providerMessageId: "unexpected" }; },
      async reconcile() { throw rejection; },
    } });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "outcome_unknown", providerMessageId: "provider-known", nextReconcileAt: Date.now(),
    }).run();

    // When
    const response = await processBatch(context.app);

    // Then
    expect(response.status).toBe(200);
    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({
      status: "outcome_unknown", reconcileAttempts: 1, leaseToken: null, leaseExpiresAt: null,
    });
  });

  it("returns 201 for creation and 200 for an exact issue replay", async () => {
    const context = await authenticatedContext();

    const first = await createIssue(context.app);
    const replay = await createIssue(context.app);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
  });

  it("does not create an issue or deliveries without an auth secret", async () => {
    const context = makeContext({ jobSecret: "job" });

    const response = await createIssue(context.app);

    expect(response.status).toBe(503);
    expect(await context.db.select().from(newsletterIssues).all()).toHaveLength(0);
    expect(await context.db.select().from(mailDeliveries).all()).toHaveLength(0);
  });

  it("rejects a same-date issue replay when the payload changes", async () => {
    const context = await authenticatedContext();
    await createIssue(context.app);

    const conflict = await createIssue(context.app, { ...ISSUE, subject: "Changed brief" });

    expect(conflict.status).toBe(409);
    expect(await context.db.select().from(newsletterIssues).all()).toHaveLength(1);
    expect(await context.db.select().from(mailDeliveries).all()).toHaveLength(0);
  });

  it("honors retry due times, succeeds eventually, and records attempts", async () => {
    let attempts = 0;
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary");
      return {};
    }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    await processBatch(context.app);
    const beforeDue = await processBatch(context.app);
    vi.advanceTimersByTime(60_000);
    await processBatch(context.app);
    vi.advanceTimersByTime(120_000);
    await processBatch(context.app);
    const delivery = await context.db.select().from(mailDeliveries).get();

    expect((await readJson<{ processed: number }>(beforeDue)).data.processed).toBe(0);
    expect(attempts).toBe(3);
    expect(delivery).toMatchObject({ status: "sent", attempts: 3, nextAttemptAt: 0 });
  });

  it("marks the third provider failure terminal", async () => {
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => { throw new Error("down"); }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    await processBatch(context.app);
    vi.advanceTimersByTime(60_000);
    await processBatch(context.app);
    vi.advanceTimersByTime(120_000);
    await processBatch(context.app);
    vi.advanceTimersByTime(10 * 60_000);
    await processBatch(context.app);

    expect(await context.db.select().from(mailDeliveries).get()).toMatchObject({ status: "failed", attempts: 3, nextAttemptAt: 0 });
  });

  it("terminalizes an exhausted expired lease without calling the provider", async () => {
    let sends = 0;
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => { sends += 1; return {}; }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "processing",
      attempts: 3,
      leaseToken: "unknown-provider-outcome",
      leaseExpiresAt: Date.now() - 1,
    }).run();

    const response = await processBatch(context.app);
    const delivery = await context.db.select().from(mailDeliveries).get();

    expect((await readJson<{ processed: number; sent: number }>(response)).data).toEqual({ processed: 1, sent: 0 });
    expect(sends).toBe(0);
    expect(delivery).toMatchObject({ status: "outcome_unknown", attempts: 3, leaseToken: null, leaseExpiresAt: null });
  });

  it("persists only a sanitized provider error classification", async () => {
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => {
      throw new Error("address 123456@qq.com rejected with secret-token");
    }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    await processBatch(context.app);
    const delivery = await context.db.select().from(mailDeliveries).get();

    expect(delivery?.lastError).toBe("provider_error");
    expect(delivery?.lastError).not.toContain("123456@qq.com");
    expect(delivery?.lastError).not.toContain("secret-token");
  });

  it("cancels delivery after unsubscribe and isolates recipients", async () => {
    const recipients: string[] = [];
    const context = await authenticatedContext({ newsletterMailProvider: provider(async (message) => { recipients.push(message.to); return {}; }) });
    await setSubscription(context.app, context.cookie, true);
    await context.db.insert(users).values({ id: "second", username: "234567@qq.com", passwordHash: "x", salt: "x", email: "234567@qq.com", name: "", avatar: "", createdAt: Date.now() }).run();
    await context.db.insert(subscriptions).values({ userId: "second", status: "subscribed", subscribedAt: Date.now(), unsubscribedAt: null, unsubscribeTokenHash: "second-token", updatedAt: Date.now() }).run();
    await createIssue(context.app);
    await setSubscription(context.app, context.cookie, false);

    await processBatch(context.app);
    const deliveries = await context.db.select().from(mailDeliveries).all();

    expect(deliveries.map((delivery) => delivery.recipient).sort()).toEqual(["123456@qq.com", "234567@qq.com"]);
    expect(deliveries.find((delivery) => delivery.recipient === "123456@qq.com")?.status).toBe("cancelled");
    expect(recipients).toEqual(["234567@qq.com"]);
  });

  it("claims a delivery once across concurrent processors", async () => {
    let sends = 0;
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => { sends += 1; return {}; }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "processing",
      leaseToken: "expired-owner",
      leaseExpiresAt: Date.now() - 1,
    }).run();

    await Promise.all([processBatch(context.app), processBatch(context.app)]);

    expect(sends).toBe(1);
  });

  it("fences an expired processing claim across two workers", async () => {
    let sends = 0;
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => { sends += 1; return {}; }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "processing",
      attempts: 1,
      leaseToken: "expired-owner",
      leaseExpiresAt: Date.now() - 1,
      nextAttemptAt: Date.now() + 60_000,
    }).run();

    const responses = await Promise.all([processBatch(context.app), processBatch(context.app)]);
    const delivery = await context.db.select().from(mailDeliveries).get();
    const processed = await Promise.all(responses.map(async (response) => (
      await readJson<{ processed: number }>(response)
    ).data.processed));

    expect(sends).toBe(1);
    expect(processed.sort()).toEqual([0, 1]);
    expect(delivery).toMatchObject({ status: "sent", attempts: 2, leaseToken: null, leaseExpiresAt: null });
  });

  it("prevents a stale successful worker from finalizing after its lease expires", async () => {
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let sends = 0;
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => {
      sends += 1;
      if (sends === 1) {
        firstStarted?.();
        await blocked;
        return { kind: "accepted", providerMessageId: "stale-provider" } as const;
      }
      return { kind: "accepted", providerMessageId: "fresh-provider" } as const;
    }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    const staleWorker = processBatch(context.app);
    await started;
    vi.advanceTimersByTime(5 * 60_000 + 1);
    const freshWorker = await processBatch(context.app);
    releaseFirst?.();
    await staleWorker;
    const delivery = await context.db.select().from(mailDeliveries).get();

    expect((await readJson<{ processed: number; sent: number }>(freshWorker)).data).toEqual({ processed: 1, sent: 1 });
    expect(delivery).toMatchObject({ status: "sent", attempts: 2, lastError: "", leaseToken: null, leaseExpiresAt: null });
    expect(delivery?.providerMessageId).not.toBe("stale-provider");
  });

  it("does not mutate subscription state through profile updates", async () => {
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });
    await setSubscription(context.app, context.cookie, true);

    const response = await context.app.request("/api/profile", {
      method: "POST",
      headers: { cookie: context.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Reader", subscribed: false }),
    });
    const state = await context.app.request("/api/subscription", { headers: { cookie: context.cookie } });

    expect(response.status).toBe(200);
    expect((await readJson<{ subscribed: boolean }>(state)).data.subscribed).toBe(true);
  });

  it("derives profile subscription state from subscriptions", async () => {
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });
    await setSubscription(context.app, context.cookie, true);

    const subscribed = await context.app.request("/api/profile", { headers: { cookie: context.cookie } });
    await setSubscription(context.app, context.cookie, false);
    const unsubscribed = await context.app.request("/api/profile", { headers: { cookie: context.cookie } });

    expect((await readJson<{ subscribed: boolean }>(subscribed)).data.subscribed).toBe(true);
    expect((await readJson<{ subscribed: boolean }>(unsubscribed)).data.subscribed).toBe(false);
  });

  it("cancels a claimed delivery and invalidates its token on unsubscribe", async () => {
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await context.db.update(mailDeliveries).set({
      status: "processing",
      leaseToken: "active-owner",
      leaseExpiresAt: Date.now() + 60_000,
    }).run();

    const response = await setSubscription(context.app, context.cookie, false);
    const subscription = await context.db.select().from(subscriptions).get();
    const delivery = await context.db.select().from(mailDeliveries).get();

    expect(response.status).toBe(200);
    expect(subscription).toMatchObject({ status: "unsubscribed", unsubscribeTokenHash: null });
    expect(delivery).toMatchObject({ status: "cancelled", leaseToken: null, leaseExpiresAt: null });
  });

  it("invalidates an old unsubscribe link after resubscribe", async () => {
    const messages: string[] = [];
    const context = await authenticatedContext({ newsletterMailProvider: provider(async (message) => { messages.push(message.text); return {}; }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    await processBatch(context.app);
    const oldToken = messages[0]?.match(/token=([^\s]+)/)?.[1] ?? "";
    await setSubscription(context.app, context.cookie, false);
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app, { ...ISSUE, date: "2026-08-16" });
    await processBatch(context.app);
    const newToken = messages[1]?.match(/token=([^\s]+)/)?.[1] ?? "";

    const oldLink = await context.app.request(`/api/subscription/unsubscribe?token=${oldToken}`);
    const newLink = await context.app.request(`/api/subscription/unsubscribe?token=${newToken}`);

    expect(oldLink.status).toBe(404);
    expect(newLink.status).toBe(200);
    expect((await context.db.select().from(subscriptions).get())?.status).toBe("unsubscribed");
  });

  it("provisions a migrated subscription with null token fields before sending", async () => {
    const messages: string[] = [];
    const context = await authenticatedContext();
    const user = await context.db.select().from(users).get();
    if (!user) throw new Error("authenticated user fixture missing");
    await context.db.insert(subscriptions).values({
      userId: user.id, status: "subscribed", subscribedAt: Date.now(), unsubscribedAt: null,
      unsubscribeTokenHash: null, unsubscribeTokenNonce: null, updatedAt: Date.now(),
    }).run();
    const app = createApp(context.db, {
      authSecret: "secret", jobSecret: "job", publicApiUrl: "https://api.example.com",
      newsletterMailProvider: provider(async (message) => { messages.push(message.text); return {}; }),
    });

    await createIssue(app);
    await processBatch(app);
    const token = messages[0]?.match(/token=([^\s]+)/)?.[1] ?? "";
    const subscription = await context.db.select().from(subscriptions).get();
    const unsubscribe = await app.request(`/api/subscription/unsubscribe?token=${token}`);

    expect(subscription?.unsubscribeTokenNonce).toBeTruthy();
    expect(subscription?.unsubscribeTokenHash).toBeTruthy();
    expect(unsubscribe.status).toBe(200);
  });

  it("refreshes the stored hash for an outgoing link after secret rotation", async () => {
    const messages: string[] = [];
    const context = await authenticatedContext();
    const user = await context.db.select().from(users).get();
    if (!user) throw new Error("authenticated user fixture missing");
    await context.db.insert(subscriptions).values({
      userId: user.id, status: "subscribed", subscribedAt: Date.now(), unsubscribedAt: null,
      unsubscribeTokenHash: "stale-secret-hash", unsubscribeTokenNonce: "existing-generation", updatedAt: Date.now(),
    }).run();
    const rotatedApp = createApp(context.db, {
      authSecret: "rotated-secret", jobSecret: "job", publicApiUrl: "https://api.example.com",
      newsletterMailProvider: provider(async (message) => { messages.push(message.text); return {}; }),
    });

    await createIssue(rotatedApp);
    await processBatch(rotatedApp);
    const token = messages[0]?.match(/token=([^\s]+)/)?.[1] ?? "";
    const subscription = await context.db.select().from(subscriptions).get();
    const unsubscribe = await rotatedApp.request(`/api/subscription/unsubscribe?token=${token}`);

    expect(subscription?.unsubscribeTokenNonce).toBeTruthy();
    expect(subscription?.unsubscribeTokenHash).toBeTruthy();
    expect(unsubscribe.status).toBe(200);
  });

  it("rejects processing when provider, public URL, or auth secret is missing", async () => {
    const noProvider = makeContext({ jobSecret: "job", publicApiUrl: "https://api.example.com", authSecret: "secret" });
    const noUrl = makeContext({ jobSecret: "job", authSecret: "secret", newsletterMailProvider: provider(async () => ({})) });
    const noAuth = makeContext({ jobSecret: "job", publicApiUrl: "https://api.example.com", newsletterMailProvider: provider(async () => ({})) });

    const responses = await Promise.all([processBatch(noProvider.app), processBatch(noUrl.app), processBatch(noAuth.app)]);

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
  });

  it("emits structured non-PII claim, retry, and batch diagnostics", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => { throw new Error("address 123456@qq.com rejected"); }) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    await processBatch(context.app);

    const output = [...info.mock.calls, ...warn.mock.calls].map((call) => String(call[0])).join("\n");
    expect(output).toContain("newsletter.delivery.claimed");
    expect(output).toContain("newsletter.delivery.retry");
    expect(output).toContain("newsletter.batch.completed");
    expect(output).not.toContain("123456@qq.com");
    expect(output).not.toContain("address");
  });
});
