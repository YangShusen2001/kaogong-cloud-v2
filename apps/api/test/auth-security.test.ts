import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailVerificationCodes, sessions } from "../src/db/schema";
import type { MailProvider } from "../src/lib/mail";
import { json, makeContext, readJson } from "./helpers";

const EMAIL = "123456@qq.com";
const NOW = new Date("2026-08-15T00:00:00.000Z");

function collectingProvider(messages: string[]): MailProvider {
  return { async send(message) { messages.push(message.text); return {}; } };
}

function codeFrom(messages: readonly string[]): string {
  return messages.at(-1)?.match(/\b(\d{6})\b/)?.[1] ?? "";
}

async function requestCode(app: ReturnType<typeof makeContext>["app"], email = EMAIL, headers: Record<string, string> = {}) {
  return app.request("/api/auth/email/code", {
    ...json("POST", { email }),
    headers: { "content-type": "application/json", "x-device-id": "device-1", "cf-connecting-ip": "192.0.2.1", ...headers },
  });
}

async function verify(app: ReturnType<typeof makeContext>["app"], code: string, email = EMAIL) {
  return app.request("/api/auth/email/verify", json("POST", { email, code }));
}

describe("auth security", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects an expired code", async () => {
    const messages: string[] = [];
    const { app } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await requestCode(app);
    vi.advanceTimersByTime(10 * 60_000 + 1);

    const response = await verify(app, codeFrom(messages));

    expect(response.status).toBe(401);
  });

  it("locks a code after five failed attempts", async () => {
    const messages: string[] = [];
    const { app } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await requestCode(app);
    const validCode = codeFrom(messages);
    const invalidCode = validCode === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt += 1) await verify(app, invalidCode);

    const response = await verify(app, validCode);

    expect(response.status).toBe(401);
  });

  it("admits at most five invalid attempts when more than five guesses are concurrent", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await requestCode(app);
    const validCode = codeFrom(messages);
    const invalidCode = validCode === "000000" ? "000001" : "000000";

    const responses = await Promise.all(Array.from({ length: 12 }, () => verify(app, invalidCode)));
    const stored = await db.select().from(emailVerificationCodes).get();

    expect(responses.every((response) => response.status === 401)).toBe(true);
    expect(stored).toMatchObject({ attempts: 5, consumedAt: null });
  });

  it("rejects a valid code after five concurrent invalid attempts have been admitted", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await requestCode(app);
    const validCode = codeFrom(messages);
    const invalidCode = validCode === "000000" ? "000001" : "000000";

    await Promise.all(Array.from({ length: 8 }, () => verify(app, invalidCode)));
    const response = await verify(app, validCode);
    const stored = await db.select().from(emailVerificationCodes).get();

    expect(response.status).toBe(401);
    expect(stored).toMatchObject({ attempts: 5, consumedAt: null });
    expect(await db.select().from(sessions).all()).toHaveLength(0);
  });

  it("throttles email, IP, and device independently while preserving an equivalent response", async () => {
    const messages: string[] = [];
    const { app } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const first = await requestCode(app);
    const firstBody = await readJson<{ message: string }>(first);
    await requestCode(app);
    for (let index = 0; index < 20; index += 1) {
      await requestCode(app, `${200000 + index}@qq.com`, { "x-device-id": `ip-device-${index}` });
    }
    await requestCode(app, "300000@qq.com", { "x-device-id": "fresh-device" });
    for (let index = 0; index < 10; index += 1) {
      await requestCode(app, `${400000 + index}@qq.com`, { "x-device-id": "shared-device", "cf-connecting-ip": `198.51.100.${index}` });
    }
    const deviceLimited = await requestCode(app, "500000@qq.com", { "x-device-id": "shared-device", "cf-connecting-ip": "203.0.113.1" });

    expect(messages).toHaveLength(30);
    expect(await readJson<{ message: string }>(deviceLimited)).toEqual(firstBody);
  });

  it("claims only one code request when identical requests are concurrent", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });

    const responses = await Promise.all([requestCode(app), requestCode(app)]);
    const rows = await db.select().from(emailVerificationCodes).all();

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(messages).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it("returns the same public response when delivery is unavailable or fails and cleans up the failed code", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const available = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider([]) });
    const unavailable = makeContext({ authSecret: "secret" });
    const failed = makeContext({ authSecret: "secret", verificationMailProvider: { async send() { throw new Error("provider down"); } } });
    await failed.db.insert(emailVerificationCodes).values({
      id: "unrelated-code",
      email: "654321@qq.com",
      codeHash: "unrelated-hash",
      expiresAt: NOW.getTime() - 1,
      attempts: 0,
      consumedAt: null,
      consumeToken: null,
      ipHash: "unrelated-ip",
      deviceId: "unrelated-device",
      createdAt: 0,
    }).run();
    const responses = await Promise.all([requestCode(available.app), requestCode(unavailable.app), requestCode(failed.app)]);

    const bodies = await Promise.all(responses.map((response) => readJson<{ message: string }>(response)));
    const failedRows = await failed.db.select().from(emailVerificationCodes).all();

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(failedRows.map((row) => row.id)).toEqual(["unrelated-code"]);
    const event = String(errors.mock.calls[0]?.[0]);
    expect(event).toBe(JSON.stringify({ event: "auth.provider.failed", errorType: "Error" }));
    expect(event).not.toContain(EMAIL);
  });

  it("allows only one concurrent verification replay", async () => {
    const messages: string[] = [];
    const { app } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await requestCode(app);

    const responses = await Promise.all([verify(app, codeFrom(messages)), verify(app, codeFrom(messages))]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  it("sets secure cookie defaults, expires sessions, and revokes logout immediately", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await requestCode(app);
    const login = await verify(app, codeFrom(messages));
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    const active = await app.request("/api/auth/session", { headers: { cookie } });
    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    const revoked = await app.request("/api/auth/session", { headers: { cookie } });
    const stored = await db.select().from(sessions).where(eq(sessions.revokedAt, Date.now())).all();

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(active.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(revoked.status).toBe(401);
    expect(stored).toHaveLength(1);

    const secondMessages: string[] = [];
    const second = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(secondMessages) });
    await requestCode(second.app);
    const secondLogin = await verify(second.app, codeFrom(secondMessages));
    const secondCookie = (secondLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    vi.advanceTimersByTime(30 * 24 * 60 * 60_000 + 1);

    expect((await second.app.request("/api/auth/session", { headers: { cookie: secondCookie } })).status).toBe(401);
  });
});
