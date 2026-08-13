import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { profileUpdateSchema, type Profile } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { users } from "../db/schema";
import { verifyToken } from "../lib/auth";
import { badInput, fail } from "../lib/http";

async function userId(c: Context, secret: string): Promise<string | null> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7).trim(), secret);
  return payload?.sub ?? null;
}

function toProfile(row: typeof users.$inferSelect): Profile {
  return {
    username: row.username,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    subscribed: row.subscribed === 1,
  };
}

export function profileRoutes(db: DB, config: AppConfig) {
  const r = new Hono();
  const secret = config.authSecret ?? "";

  r.get("/", async (c) => {
    if (!secret) return fail(c, 503, "AUTH_UNAVAILABLE", "未配置 AUTH_SECRET");
    const id = await userId(c, secret);
    if (!id) return fail(c, 401, "AUTH_REQUIRED", "未登录");
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) return fail(c, 401, "AUTH_REQUIRED", "用户不存在");
    return c.json({ ok: true, data: toProfile(user) });
  });

  r.post("/", async (c) => {
    if (!secret) return fail(c, 503, "AUTH_UNAVAILABLE", "未配置 AUTH_SECRET");
    const id = await userId(c, secret);
    if (!id) return fail(c, 401, "AUTH_REQUIRED", "未登录");
    let raw: Record<string, unknown> = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = profileUpdateSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.email !== undefined) updates.email = parsed.data.email;
    if (parsed.data.avatar !== undefined) updates.avatar = parsed.data.avatar;
    if (parsed.data.subscribed !== undefined) updates.subscribed = parsed.data.subscribed ? 1 : 0;
    if (Object.keys(updates).length) {
      db.update(users).set(updates).where(eq(users.id, id)).run();
    }
    const user = db.select().from(users).where(eq(users.id, id)).get()!;
    return c.json({ ok: true, data: toProfile(user) });
  });

  return r;
}
