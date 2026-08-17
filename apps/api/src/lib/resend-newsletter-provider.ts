import { z } from "zod";
import type {
  NewsletterMailProvider,
  NewsletterProviderEvent,
  NewsletterReconcileResult,
  NewsletterSendResult,
} from "./newsletter-mail-provider";

const API_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
const acceptedSchema = z.object({ id: z.string().min(1) });
const errorSchema = z.object({ name: z.string() }).passthrough();
const providerEventSchema = z.enum([
  "sent", "delivered", "delivery_delayed", "failed", "bounced", "complained", "suppressed",
]);
const reconcileSchema = z.object({ id: z.string().min(1), last_event: providerEventSchema });

type ResendProviderOptions = {
  readonly apiKey: string;
  readonly from: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
};

function classify(status: number, errorName: string | undefined): Exclude<NewsletterSendResult, { readonly kind: "accepted" } | { readonly kind: "outcome_unknown" }> {
  if (status === 409 && errorName === "concurrent_idempotent_requests") return { kind: "retryable", reason: "idempotency_in_progress" };
  if (status === 429) return { kind: "retryable", reason: "rate_limited" };
  if (status >= 500) return { kind: "retryable", reason: "provider_unavailable" };
  return { kind: "permanent", reason: "request_rejected" };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error) return undefined;
    throw error;
  }
}

export function resendNewsletterMailProvider(options: ResendProviderOptions): NewsletterMailProvider {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const authorization = `Bearer ${options.apiKey}`;
  return {
    async send(message): Promise<NewsletterSendResult> {
      try {
        const response = await fetcher(API_URL, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({ from: options.from, to: [message.to], subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseBody = await parseJson(response);
        if (!response.ok) {
          const parsedError = errorSchema.safeParse(responseBody);
          return classify(response.status, parsedError.success ? parsedError.data.name : undefined);
        }
        const parsed = acceptedSchema.safeParse(responseBody);
        return parsed.success
          ? { kind: "accepted", providerMessageId: parsed.data.id }
          : { kind: "outcome_unknown", reason: "malformed_success" };
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError") return { kind: "outcome_unknown", reason: "timeout" };
        if (error instanceof Error) return { kind: "outcome_unknown", reason: "transport" };
        throw error;
      }
    },
    async reconcile(providerMessageId): Promise<NewsletterReconcileResult> {
      try {
        const response = await fetcher(`${API_URL}/${encodeURIComponent(providerMessageId)}`, {
          method: "GET",
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 404) return { kind: "not_found" };
        if (response.status === 429 || response.status >= 500) return { kind: "retryable" };
        if (!response.ok) return { kind: "permanent" };
        const parsed = reconcileSchema.safeParse(await parseJson(response));
        if (!parsed.success) return { kind: "outcome_unknown" };
        return { kind: "found", event: parsed.data.last_event satisfies NewsletterProviderEvent };
      } catch (error) {
        if (error instanceof Error) return { kind: "outcome_unknown" };
        throw error;
      }
    },
  };
}
