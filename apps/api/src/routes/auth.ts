import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { credentialsSchema } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { users } from "../db/schema";
import { hashPassword, signToken, verifyPassword, verifyToken } from "../lib/auth";
import { badInput, fail } from "../lib/http";

function bearerToken(c: Context): string | null {
  const h = c.req.header("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

export function authRoutes(db: DB, config: AppConfig) {
  const r = new Hono();
  const secret = config.authSecret ?? "";

  r.post("/register", async (c) => {
    if (!secret) return fail(c, 503, "AUTH_UNAVAILABLE", "未配置 AUTH_SECRET");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { username, password } = parsed.data;
    const existing = db.select().from(users).where(eq(users.username, username)).get();
    if (existing) return fail(c, 409, "USERNAME_TAKEN", "用户名已存在");
    const { hash, salt } = await hashPassword(password);
    const id = crypto.randomUUID();
    db.insert(users).values({ id, username, passwordHash: hash, salt, createdAt: Date.now() }).run();
    const token = await signToken(id, username, secret);
    return c.json({ ok: true, data: { token, user: { id, username } } }, 201);
  });

  r.post("/login", async (c) => {
    if (!secret) return fail(c, 503, "AUTH_UNAVAILABLE", "未配置 AUTH_SECRET");
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const { username, password } = parsed.data;
    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user) return fail(c, 401, "BAD_CREDENTIALS", "用户名或密码错误");
    const ok = await verifyPassword(password, user.salt, user.passwordHash);
    if (!ok) return fail(c, 401, "BAD_CREDENTIALS", "用户名或密码错误");
    const token = await signToken(user.id, user.username, secret);
    return c.json({ ok: true, data: { token, user: { id: user.id, username: user.username } } });
  });

  r.get("/me", async (c) => {
    if (!secret) return fail(c, 503, "AUTH_UNAVAILABLE", "未配置 AUTH_SECRET");
    const token = bearerToken(c);
    if (!token) return fail(c, 401, "AUTH_REQUIRED", "未登录");
    const payload = await verifyToken(token, secret);
    if (!payload) return fail(c, 401, "AUTH_REQUIRED", "登录已过期");
    return c.json({ ok: true, data: { id: payload.sub, username: payload.username } });
  });

  return r;
}
