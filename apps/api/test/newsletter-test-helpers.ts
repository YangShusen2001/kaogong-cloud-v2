import type { MailProvider } from "../src/lib/mail";
import { json, makeContext } from "./helpers";

export const JOB_HEADERS = { "x-job-secret": "job" } as const;
export const ISSUE = { date: "2026-08-15", subject: "Daily brief", text: "Issue body" } as const;

export function provider(send: MailProvider["send"]): MailProvider {
  return { send };
}

export async function authenticatedContext(overrides: Parameters<typeof makeContext>[0] = {}) {
  const verification: string[] = [];
  const context = makeContext({
    authSecret: "secret",
    jobSecret: "job",
    publicApiUrl: "https://api.example.com",
    secureCookies: false,
    verificationMailProvider: provider(async (message) => {
      verification.push(message.text);
      return {};
    }),
    ...overrides,
  });
  await context.app.request("/api/auth/email/code", json("POST", { email: "123456@qq.com" }));
  const code = verification[0]?.match(/\b(\d{6})\b/)?.[1] ?? "";
  const login = await context.app.request("/api/auth/email/verify", json("POST", { email: "123456@qq.com", code }));
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { ...context, cookie };
}

export async function setSubscription(app: Awaited<ReturnType<typeof authenticatedContext>>["app"], cookie: string, subscribed: boolean) {
  return app.request("/api/subscription", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ subscribed }),
  });
}

export async function createIssue(
  app: Awaited<ReturnType<typeof authenticatedContext>>["app"],
  issue: { readonly date: string; readonly subject: string; readonly text: string } = ISSUE,
) {
  return app.request("/api/newsletter/issues", {
    method: "POST",
    headers: { ...JOB_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(issue),
  });
}

export async function processBatch(app: Awaited<ReturnType<typeof authenticatedContext>>["app"]) {
  return app.request("/api/newsletter/process", { method: "POST", headers: JOB_HEADERS });
}
