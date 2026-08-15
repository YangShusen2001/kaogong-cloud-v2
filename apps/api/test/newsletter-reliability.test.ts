import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    expect((await readJson<{ subscribed: boolean; deliveryAvailable: boolean }>(state)).data).toEqual({ subscribed: false, deliveryAvailable: false });
    expect((await readJson<{ deliveryAvailable: boolean }>(availableState)).data.deliveryAvailable).toBe(true);
    expect(subscribe.status).toBe(503);
  });

  it("allows unsubscribe without provider or auth secret", async () => {
    const context = await authenticatedContext();
    const appWithoutServices = createApp(context.db);

    const response = await setSubscription(appWithoutServices, context.cookie, false);

    expect(response.status).toBe(200);
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

  it("prevents a stale worker from finalizing after its lease expires", async () => {
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
        throw new Error("stale failure");
      }
      return {};
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
