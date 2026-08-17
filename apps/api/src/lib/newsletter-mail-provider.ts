export type NewsletterMailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly idempotencyKey: string;
};

export type NewsletterSendResult =
  | { readonly kind: "accepted"; readonly providerMessageId: string }
  | { readonly kind: "retryable"; readonly reason: "rate_limited" | "provider_unavailable" | "idempotency_in_progress" }
  | { readonly kind: "permanent"; readonly reason: "request_rejected" }
  | { readonly kind: "outcome_unknown"; readonly reason: "transport" | "timeout" | "malformed_success" };

export type NewsletterProviderEvent =
  | "sent" | "delivered" | "delivery_delayed" | "failed" | "bounced" | "complained" | "suppressed";

export type NewsletterReconcileResult =
  | { readonly kind: "found"; readonly event: NewsletterProviderEvent }
  | { readonly kind: "not_found" }
  | { readonly kind: "retryable" }
  | { readonly kind: "permanent" }
  | { readonly kind: "outcome_unknown" };

export interface NewsletterMailProvider {
  send(message: NewsletterMailMessage): Promise<NewsletterSendResult>;
  reconcile(providerMessageId: string): Promise<NewsletterReconcileResult>;
}
