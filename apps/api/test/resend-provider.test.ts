import { describe, expect, it, vi } from "vitest";
import { resendNewsletterMailProvider } from "../src/lib/resend-newsletter-provider";

const MESSAGE = {
  to: "reader@example.com",
  subject: "Daily brief",
  text: "Issue body",
  idempotencyKey: "delivery-stable-id",
} as const;

describe("Resend newsletter provider", () => {
  it("uses the delivery id unchanged as the idempotency key when sending", async () => {
    // Given
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "provider-id" }), { status: 200 }));
    const provider = resendNewsletterMailProvider({ apiKey: "secret", from: "Brief <brief@example.com>", fetcher });

    // When
    const result = await provider.send(MESSAGE);

    // Then
    expect(result).toEqual({ kind: "accepted", providerMessageId: "provider-id" });
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "delivery-stable-id" }),
    }));
  });

  it.each([
    [429, "retryable"],
    [500, "retryable"],
    [400, "permanent"],
  ] as const)("classifies HTTP %i as %s", async (status, kind) => {
    // Given
    const provider = resendNewsletterMailProvider({
      apiKey: "secret",
      from: "brief@example.com",
      fetcher: async () => new Response("provider detail", { status }),
    });

    // When
    const result = await provider.send(MESSAGE);

    // Then
    expect(result.kind).toBe(kind);
  });

  it("retries only the concurrent idempotency form of HTTP 409", async () => {
    // Given
    const concurrent = resendNewsletterMailProvider({ apiKey: "secret", from: "brief@example.com", fetcher: async () => new Response(JSON.stringify({ name: "concurrent_idempotent_requests" }), { status: 409 }) });
    const mismatch = resendNewsletterMailProvider({ apiKey: "secret", from: "brief@example.com", fetcher: async () => new Response(JSON.stringify({ name: "invalid_idempotent_request" }), { status: 409 }) });

    // When / Then
    expect((await concurrent.send(MESSAGE)).kind).toBe("retryable");
    expect((await mismatch.send(MESSAGE)).kind).toBe("permanent");
  });

  it("classifies a malformed successful response as outcome unknown", async () => {
    // Given
    const provider = resendNewsletterMailProvider({
      apiKey: "secret",
      from: "brief@example.com",
      fetcher: async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    });

    // When
    const result = await provider.send(MESSAGE);

    // Then
    expect(result).toEqual({ kind: "outcome_unknown", reason: "malformed_success" });
  });

  it("reconciles a known provider id with GET and parses last_event", async () => {
    // Given
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "provider-id", last_event: "delivered" }), { status: 200 }));
    const provider = resendNewsletterMailProvider({ apiKey: "secret", from: "brief@example.com", fetcher });

    // When
    const result = await provider.reconcile("provider-id");

    // Then
    expect(result).toEqual({ kind: "found", event: "delivered" });
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails/provider-id", expect.objectContaining({ method: "GET" }));
  });
});
