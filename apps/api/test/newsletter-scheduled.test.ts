import { afterEach, describe, expect, it, vi } from "vitest";
import { processScheduledNewsletter, type AppConfig } from "../src/app";
import { mailDeliveries } from "../src/db/schema";
import { createConfig } from "../src/index";
import { authenticatedContext, createIssue, provider, setSubscription } from "./newsletter-test-helpers";

const PROCESSING_CONFIG = {
  authSecret: "secret",
  publicApiUrl: "https://api.example.com",
} satisfies AppConfig;

describe("scheduled newsletter processing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips without a newsletter provider and leaves deliveries untouched", async () => {
    // Given
    const context = await authenticatedContext({ newsletterMailProvider: provider(async () => ({})) });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);
    const before = await context.db.select().from(mailDeliveries).all();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // When
    const result = await processScheduledNewsletter(context.db, PROCESSING_CONFIG);

    // Then
    expect(result).toEqual({ kind: "skipped", reason: "provider_unavailable" });
    expect(await context.db.select().from(mailDeliveries).all()).toEqual(before);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({
      event: "newsletter.schedule.skipped",
      reason: "provider_unavailable",
    }));
  });

  it("processes an existing delivery through the internal service", async () => {
    // Given
    const recipients: string[] = [];
    const newsletterMailProvider = provider(async (message) => {
      recipients.push(message.to);
      return {};
    });
    const context = await authenticatedContext({ newsletterMailProvider });
    await setSubscription(context.app, context.cookie, true);
    await createIssue(context.app);

    // When
    const result = await processScheduledNewsletter(context.db, {
      ...PROCESSING_CONFIG,
      newsletterMailProvider,
    });

    // Then
    expect(result).toEqual({ kind: "processed", processed: 1, sent: 1 });
    expect(recipients).toEqual(["123456@qq.com"]);
  });

  it("keeps the EMAIL binding exclusive to verification config", () => {
    // Given
    const EMAIL = { async send() { return undefined; } };

    // When
    const config = createConfig({ EMAIL, MAIL_FROM: "verify@example.com" });

    // Then
    expect(config.verificationMailProvider).toBeDefined();
    expect(config.newsletterMailProvider).toBeUndefined();
  });
});
