import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  favorites,
  emailVerificationCodes,
  highlightParagraphs,
  highlights,
  practice,
  sessions,
  users,
} from "../src/db/schema";
import type { MailProvider } from "../src/lib/mail";
import { json, makeContext, readJson } from "./helpers";

const EMAIL = "123456@qq.com";
const DEVICE = "device-owned-1234";
const DEVICE_OWNER = `device:${DEVICE}`;
const NOW = new Date("2026-08-15T00:00:00.000Z");

function collectingProvider(messages: string[]): MailProvider {
  return { async send(message) { messages.push(message.text); return {}; } };
}

function codeFrom(messages: readonly string[]): string {
  return messages.at(-1)?.match(/\b(\d{6})\b/)?.[1] ?? "";
}

async function requestCode(app: ReturnType<typeof makeContext>["app"], messages: readonly string[]): Promise<string> {
  await app.request("/api/auth/email/code", {
    ...json("POST", { email: EMAIL }, DEVICE),
    headers: {
      "content-type": "application/json",
      "x-device-id": DEVICE,
      "cf-connecting-ip": "192.0.2.10",
    },
  });
  return codeFrom(messages);
}

function verify(app: ReturnType<typeof makeContext>["app"], code: string, deviceId: string | null = DEVICE): Promise<Response> {
  const request = deviceId === null
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, code }) }
    : json("POST", { email: EMAIL, code }, deviceId);
  return Promise.resolve(app.request("/api/auth/email/verify", request));
}

describe("anonymous account merge", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("stores new anonymous rows only in the device namespace", async () => {
    const { app, db } = makeContext();

    await app.request("/api/favorites", json("POST", { url: "https://example.com/device", title: "device" }, DEVICE));

    expect(await db.select().from(favorites).get()).toMatchObject({ ownerId: DEVICE_OWNER });
  });

  it("merges device data into an existing account with deterministic conflict rules", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const userId = "account-user";
    const userOwner = `user:${userId}`;
    await db.insert(users).values({
      id: userId,
      username: EMAIL,
      passwordHash: "email-code-only",
      salt: "email-code-only",
      email: EMAIL,
      name: "",
      avatar: "",
      createdAt: NOW.getTime() - 1_000,
    }).run();
    await db.insert(favorites).values([
      { id: "account-favorite", ownerId: userOwner, url: "https://example.com/shared", title: "account", source: "", note: "", createdAt: 1 },
      { id: "device-conflict", ownerId: DEVICE_OWNER, url: "https://example.com/shared", title: "device", source: "", note: "", createdAt: 2 },
      { id: "device-only", ownerId: DEVICE_OWNER, url: "https://example.com/device", title: "device only", source: "", note: "", createdAt: 3 },
    ]).run();
    await db.insert(highlightParagraphs).values([
      { ownerId: userOwner, articleId: "later-device", paragraphIndex: 0, version: 7, spans: '[{"text":"account"}]', updatedAt: 100 },
      { ownerId: DEVICE_OWNER, articleId: "later-device", paragraphIndex: 0, version: 3, spans: '[{"text":"device"}]', updatedAt: 200 },
      { ownerId: userOwner, articleId: "equal-account", paragraphIndex: 1, version: 2, spans: '[{"text":"account wins"}]', updatedAt: 300 },
      { ownerId: DEVICE_OWNER, articleId: "equal-account", paragraphIndex: 1, version: 9, spans: '[{"text":"device loses"}]', updatedAt: 300 },
      { ownerId: DEVICE_OWNER, articleId: "tombstone", paragraphIndex: 2, version: 4, spans: "[]", updatedAt: 400 },
    ]).run();
    await db.insert(practice).values([
      { ownerId: userOwner, date: "2026-08-14", correct: 9, total: 10 },
      { ownerId: DEVICE_OWNER, date: "2026-08-14", correct: 1, total: 10 },
      { ownerId: DEVICE_OWNER, date: "2026-08-15", correct: 8, total: 10 },
    ]).run();
    await db.insert(highlights).values({
      id: "legacy-device",
      ownerId: DEVICE_OWNER,
      articleId: "legacy-only",
      text: "legacy",
      note: "",
      styles: '["green"]',
      paragraphIndex: 0,
      startOffset: 0,
      endOffset: 6,
      createdAt: 10,
    }).run();
    const code = await requestCode(app, messages);

    const response = await verify(app, code);

    expect(response.status).toBe(200);
    expect((await readJson<{ user: { id: string } }>(response)).data.user.id).toBe(userId);
    expect(await db.select().from(favorites).where(eq(favorites.ownerId, userOwner)).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "account-favorite", title: "account" }),
      expect.objectContaining({ id: "device-only", title: "device only" }),
    ]));
    expect(await db.select().from(favorites).where(eq(favorites.ownerId, DEVICE_OWNER)).all()).toHaveLength(0);
    expect(await db.select().from(highlightParagraphs).where(eq(highlightParagraphs.ownerId, userOwner)).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ articleId: "later-device", spans: '[{"text":"device"}]', version: 8, updatedAt: 200 }),
      expect.objectContaining({ articleId: "equal-account", spans: '[{"text":"account wins"}]', version: 10, updatedAt: 300 }),
      expect.objectContaining({ articleId: "tombstone", spans: "[]", version: 5, updatedAt: 400 }),
    ]));
    expect(await db.select().from(practice).where(eq(practice.ownerId, userOwner)).all()).toEqual(expect.arrayContaining([
      { ownerId: userOwner, date: "2026-08-14", correct: 9, total: 10 },
      { ownerId: userOwner, date: "2026-08-15", correct: 8, total: 10 },
    ]));
    expect(await db.select().from(highlights).where(eq(highlights.id, "legacy-device")).get()).toMatchObject({ ownerId: userOwner });
  });

  it("allows one concurrent replay to merge and create a session without partial loser writes", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await db.insert(favorites).values({
      id: "device-only",
      ownerId: DEVICE_OWNER,
      url: "https://example.com/device",
      title: "device only",
      source: "",
      note: "",
      createdAt: 1,
    }).run();
    const code = await requestCode(app, messages);

    const responses = await Promise.all([verify(app, code), verify(app, code)]);
    const account = await db.select().from(users).where(eq(users.email, EMAIL)).get();
    const accountSessions = account ? await db.select().from(sessions).where(eq(sessions.userId, account.id)).all() : [];
    const moved = account ? await db.select().from(favorites).where(and(
      eq(favorites.ownerId, `user:${account.id}`), eq(favorites.id, "device-only"),
    )).all() : [];

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(accountSessions).toHaveLength(1);
    expect(moved).toHaveLength(1);
    expect(await db.select().from(favorites).where(eq(favorites.ownerId, DEVICE_OWNER)).all()).toHaveLength(0);
  });

  it("attaches a verified email to a legacy username account before merging and creating its session", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const legacyUserId = "legacy-username-user";
    const legacyOwner = `user:${legacyUserId}`;
    await db.insert(users).values({
      id: legacyUserId,
      username: EMAIL,
      passwordHash: "legacy-password",
      salt: "legacy-salt",
      email: "",
      name: "legacy",
      avatar: "",
      createdAt: 1,
    }).run();
    await db.insert(favorites).values({
      id: "legacy-collision-device-row",
      ownerId: DEVICE_OWNER,
      url: "https://example.com/legacy-collision",
      title: "device only",
      source: "",
      note: "",
      createdAt: 2,
    }).run();
    const code = await requestCode(app, messages);

    const response = await verify(app, code);
    const storedUsers = await db.select().from(users).all();
    const storedSessions = await db.select().from(sessions).all();

    expect(response.status).toBe(200);
    expect((await readJson<{ user: { id: string } }>(response)).data.user.id).toBe(legacyUserId);
    expect(storedUsers).toHaveLength(1);
    expect(storedUsers[0]).toMatchObject({ id: legacyUserId, username: EMAIL, email: EMAIL });
    expect(storedSessions).toEqual([expect.objectContaining({ userId: legacyUserId })]);
    expect(await db.select().from(favorites).where(eq(favorites.ownerId, legacyOwner)).all()).toHaveLength(1);
    expect((await db.select().from(favorites).all()).some((row) => row.ownerId.startsWith("user:") && row.ownerId !== legacyOwner)).toBe(false);
  });

  it("does not consume the code or move owners when a canonical user cannot be created", async () => {
    const messages: string[] = [];
    const { app, db, sqlite } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await db.insert(favorites).values({
      id: "unresolved-device-row",
      ownerId: DEVICE_OWNER,
      url: "https://example.com/unresolved",
      title: "device only",
      source: "",
      note: "",
      createdAt: 1,
    }).run();
    const code = await requestCode(app, messages);
    sqlite.exec(`CREATE TRIGGER ignore_email_user_insert
      BEFORE INSERT ON users
      WHEN NEW.password_hash = 'email-code-only'
      BEGIN SELECT RAISE(IGNORE); END`);

    const response = await verify(app, code);
    const verification = await db.select().from(emailVerificationCodes).get();

    expect(response.status).toBe(500);
    expect(verification).toMatchObject({ attempts: 0, consumedAt: null, consumeToken: null });
    expect(await db.select().from(users).all()).toHaveLength(0);
    expect(await db.select().from(sessions).all()).toHaveLength(0);
    expect(await db.select().from(favorites).where(eq(favorites.ownerId, DEVICE_OWNER)).all()).toHaveLength(1);
    expect((await db.select().from(favorites).all()).some((row) => row.ownerId.startsWith("user:"))).toBe(false);
  });

  it("does not let malformed legacy styles block login or create malformed paragraph state", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const userId = "malformed-existing-user";
    const userOwner = `user:${userId}`;
    await db.insert(users).values({
      id: userId,
      username: EMAIL,
      passwordHash: "email-code-only",
      salt: "email-code-only",
      email: EMAIL,
      name: "",
      avatar: "",
      createdAt: 0,
    }).run();
    await db.insert(highlightParagraphs).values({
      ownerId: userOwner,
      articleId: "malformed-article",
      paragraphIndex: 0,
      version: 1,
      spans: '[{"text":"valid","note":"","styles":["green"],"start":0,"end":5}]',
      updatedAt: 2,
    }).run();
    await db.insert(highlights).values({
      id: "malformed-legacy",
      ownerId: DEVICE_OWNER,
      articleId: "malformed-article",
      text: "legacy",
      note: "",
      styles: "not-json",
      paragraphIndex: 0,
      startOffset: 0,
      endOffset: 6,
      createdAt: 1,
    }).run();
    const code = await requestCode(app, messages);

    const response = await verify(app, code);

    expect(response.status).toBe(200);
    expect(await db.select().from(highlights).where(eq(highlights.id, "malformed-legacy")).get())
      .toMatchObject({ ownerId: userOwner, styles: "not-json" });
    expect(await db.select().from(highlightParagraphs).where(eq(highlightParagraphs.ownerId, userOwner)).get())
      .toMatchObject({ version: 2, spans: '[{"text":"valid","note":"","styles":["green"],"start":0,"end":5}]' });
  });

  it.each([
    ["missing", null],
    ["invalid", "bad"],
  ])("logs in without merging when the device header is %s", async (_condition, deviceId) => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    await db.insert(favorites).values({
      id: "device-only",
      ownerId: DEVICE_OWNER,
      url: "https://example.com/device",
      title: "device only",
      source: "",
      note: "",
      createdAt: 1,
    }).run();
    const code = await requestCode(app, messages);

    const response = await verify(app, code, deviceId);

    expect(response.status).toBe(200);
    expect(await db.select().from(favorites).where(eq(favorites.ownerId, DEVICE_OWNER)).all()).toHaveLength(1);
  });

  it("cannot read, mutate, or transfer rows addressed by a raw user UUID header", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const victimId = "victim-user-uuid";
    const victimOwner = `user:${victimId}`;
    await db.insert(favorites).values({
      id: "victim-favorite", ownerId: victimOwner, url: "https://example.com/victim", title: "victim", source: "", note: "", createdAt: 1,
    }).run();
    await db.insert(highlights).values({
      id: "victim-legacy", ownerId: victimOwner, articleId: "victim", text: "victim", note: "", styles: '["green"]', paragraphIndex: 0, startOffset: 0, endOffset: 6, createdAt: 2,
    }).run();
    await db.insert(highlightParagraphs).values({
      ownerId: victimOwner, articleId: "victim", paragraphIndex: 1, version: 4, spans: "[]", updatedAt: 3,
    }).run();
    await db.insert(practice).values({ ownerId: victimOwner, date: "2026-08-15", correct: 9, total: 10 }).run();

    const listed = await app.request("/api/favorites", { headers: { "x-device-id": victimId } });
    await app.request("/api/favorites/victim-favorite", { method: "DELETE", headers: { "x-device-id": victimId } });
    const listedLegacy = await app.request("/api/highlights", { headers: { "x-device-id": victimId } });
    await app.request("/api/highlights/victim-legacy", { method: "DELETE", headers: { "x-device-id": victimId } });
    const listedParagraphs = await app.request("/api/highlights/paragraphs/victim", { headers: { "x-device-id": victimId } });
    const listedPractice = await app.request("/api/practice", { headers: { "x-device-id": victimId } });
    const code = await requestCode(app, messages);
    const login = await verify(app, code, victimId);

    expect((await listed.json<{ data: readonly unknown[] }>()).data).toEqual([]);
    expect((await listedLegacy.json<{ data: readonly unknown[] }>()).data).toEqual([]);
    expect((await listedParagraphs.json<{ data: readonly unknown[] }>()).data).toEqual([]);
    expect((await listedPractice.json<{ data: readonly unknown[] }>()).data).toEqual([]);
    expect(login.status).toBe(200);
    expect(await db.select().from(favorites).where(eq(favorites.id, "victim-favorite")).get()).toMatchObject({ ownerId: victimOwner });
    expect(await db.select().from(highlights).where(eq(highlights.id, "victim-legacy")).get()).toMatchObject({ ownerId: victimOwner });
    expect(await db.select().from(highlightParagraphs).where(eq(highlightParagraphs.ownerId, victimOwner)).get()).toMatchObject({ version: 4 });
    expect(await db.select().from(practice).where(eq(practice.ownerId, victimOwner)).get()).toMatchObject({ correct: 9 });
  });

  it.each([
    ["account tombstone wins when newer", "account", 300, 200, "[]"],
    ["device legacy wins when newer", "account", 200, 300, '[{"text":"legacy","note":"","styles":["green"],"start":0,"end":6}]'],
    ["device tombstone wins when newer", "device", 300, 200, "[]"],
    ["account legacy wins when newer", "device", 200, 300, '[{"text":"legacy","note":"","styles":["green"],"start":0,"end":6}]'],
    ["account wins an equal tombstone and legacy timestamp", "account", 300, 300, "[]"],
    ["account legacy wins an equal timestamp", "device", 300, 300, '[{"text":"legacy","note":"","styles":["green"],"start":0,"end":6}]'],
  ])("reconciles %s", async (_case, versionOwner, versionTime, legacyTime, expectedSpans) => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const userId = "collision-account";
    const userOwner = `user:${userId}`;
    await db.insert(users).values({
      id: userId, username: EMAIL, passwordHash: "email-code-only", salt: "email-code-only",
      email: EMAIL, name: "", avatar: "", createdAt: 1,
    }).run();
    await db.insert(highlightParagraphs).values({
      ownerId: versionOwner === "account" ? userOwner : DEVICE_OWNER,
      articleId: "collision", paragraphIndex: 0, version: 5, spans: "[]", updatedAt: versionTime,
    }).run();
    await db.insert(highlights).values({
      id: "legacy", ownerId: versionOwner === "account" ? DEVICE_OWNER : userOwner,
      articleId: "collision", text: "legacy", note: "", styles: '["green"]',
      paragraphIndex: 0, startOffset: 0, endOffset: 6, createdAt: legacyTime,
    }).run();
    const code = await requestCode(app, messages);

    await verify(app, code);

    const state = await db.select().from(highlightParagraphs).where(and(
      eq(highlightParagraphs.ownerId, userOwner), eq(highlightParagraphs.articleId, "collision"),
    )).get();
    expect(state?.spans).toBe(expectedSpans);
    expect(state?.version).toBeGreaterThan(5);
    expect(await db.select().from(highlights).where(and(
      eq(highlights.ownerId, userOwner), eq(highlights.articleId, "collision"),
    )).all()).toHaveLength(0);
  });

  it("does not rewrite account-only highlights when the presented device owns no matching data", async () => {
    const messages: string[] = [];
    const { app, db } = makeContext({ authSecret: "secret", verificationMailProvider: collectingProvider(messages) });
    const userId = "account-only";
    const userOwner = `user:${userId}`;
    await db.insert(users).values({
      id: userId, username: EMAIL, passwordHash: "email-code-only", salt: "email-code-only",
      email: EMAIL, name: "", avatar: "", createdAt: 1,
    }).run();
    await db.insert(highlightParagraphs).values({
      ownerId: userOwner, articleId: "account-only", paragraphIndex: 0, version: 9, spans: "[]", updatedAt: 500,
    }).run();
    await db.insert(highlights).values({
      id: "account-legacy", ownerId: userOwner, articleId: "legacy-only", text: "account",
      note: "", styles: '["green"]', paragraphIndex: 1, startOffset: 0, endOffset: 7, createdAt: 600,
    }).run();
    const code = await requestCode(app, messages);

    await verify(app, code);

    expect(await db.select().from(highlightParagraphs).where(eq(highlightParagraphs.ownerId, userOwner)).get()).toMatchObject({
      version: 9, spans: "[]", updatedAt: 500,
    });
    expect(await db.select().from(highlights).where(eq(highlights.id, "account-legacy")).get()).toMatchObject({
      ownerId: userOwner, createdAt: 600,
    });
  });
});
