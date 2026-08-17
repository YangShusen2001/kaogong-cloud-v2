import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { inviteActivateSchema } from "@kaogong/contracts";
import type { AppConfig, DB } from "../app";
import { inviteActivations, inviteCodes } from "../db/schema";
import { resolveOwnerId } from "../lib/identity";
import { constantEqual } from "../lib/auth";
import { badInput, fail } from "../lib/http";

/** 每个共享邀请码的初始额度。 */
export const INVITE_TOTAL = 100;

/** 无歧义字符集（去掉 0/O/1/I/L），12 位大写字母数字。 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!).join("");
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function authorized(config: AppConfig, header: string | undefined): boolean {
  return Boolean(config.jobSecret && header && constantEqual(header, config.jobSecret));
}

export type InviteQuotaResult = "granted" | "no_activation" | "exhausted";

/** 只读检查当前 owner 的邀请码额度状态（不扣减）。 */
export async function getInviteQuotaState(db: DB, owner: string): Promise<"no_activation" | "exhausted" | "available"> {
  const activation = await db.select().from(inviteActivations).where(eq(inviteActivations.ownerId, owner)).get();
  if (!activation) return "no_activation";
  const row = await db.select().from(inviteCodes).where(eq(inviteCodes.code, activation.code)).get();
  if (!row || row.remaining <= 0) return "exhausted";
  return "available";
}

/** 消耗当前 owner 已激活邀请码的一次额度（原子扣减），并区分未激活 / 已耗尽。 */
export async function consumeInviteQuota(db: DB, owner: string): Promise<InviteQuotaResult> {
  const activation = await db.select().from(inviteActivations).where(eq(inviteActivations.ownerId, owner)).get();
  if (!activation) return "no_activation";
  const updated = await db.update(inviteCodes)
    .set({ remaining: sql`${inviteCodes.remaining} - 1` })
    .where(and(eq(inviteCodes.code, activation.code), gt(inviteCodes.remaining, 0)))
    .returning()
    .all();
  return updated.length > 0 ? "granted" : "exhausted";
}

export function inviteRoutes(db: DB, config: AppConfig) {
  const r = new Hono();

  // 管理端：生成共享邀请码（100 次），返回明文码（仅此一次）。
  r.post("/admin/invite-codes", async (c) => {
    if (!authorized(config, c.req.header("x-job-secret"))) {
      return fail(c, 401, "JOB_AUTH_REQUIRED", "未授权任务");
    }
    const code = generateCode();
    const now = Date.now();
    await db.insert(inviteCodes).values({ code, remaining: INVITE_TOTAL, total: INVITE_TOTAL, createdAt: now }).run();
    return c.json({ ok: true, data: { code, total: INVITE_TOTAL, remaining: INVITE_TOTAL, createdAt: now } });
  });

  // 管理端：列出全部邀请码及剩余次数。
  r.get("/admin/invite-codes", async (c) => {
    if (!authorized(config, c.req.header("x-job-secret"))) {
      return fail(c, 401, "JOB_AUTH_REQUIRED", "未授权任务");
    }
    const rows = await db.select().from(inviteCodes).all();
    return c.json({
      ok: true,
      data: rows.map((row) => ({ code: row.code, total: row.total, remaining: row.remaining, createdAt: row.createdAt })),
    });
  });

  // 激活：把共享码绑定到当前 owner（登录绑账号 / 未登录绑设备）。
  r.post("/activate", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    let raw: unknown = {};
    try { raw = await c.req.json(); } catch { raw = {}; }
    const parsed = inviteActivateSchema.safeParse(raw);
    if (!parsed.success) return badInput(c, parsed.error.issues[0]?.message ?? "参数非法");
    const code = normalizeCode(parsed.data.code);
    const row = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).get();
    if (!row) return fail(c, 404, "INVITE_NOT_FOUND", "邀请码不存在");
    if (row.remaining <= 0) return fail(c, 410, "INVITE_EXHAUSTED", "邀请码额度已用完");
    await db.insert(inviteActivations).values({ ownerId: owner, code, activatedAt: Date.now() })
      .onConflictDoUpdate({ target: inviteActivations.ownerId, set: { code, activatedAt: Date.now() } }).run();
    return c.json({ ok: true, data: { active: true, remaining: row.remaining, code } });
  });

  // 状态：当前 owner 是否已激活 + 剩余次数。
  r.get("/status", async (c) => {
    const owner = await resolveOwnerId(c, db);
    if (!owner) return fail(c, 400, "IDENTITY_REQUIRED", "缺少身份标识");
    const activation = await db.select().from(inviteActivations).where(eq(inviteActivations.ownerId, owner)).get();
    if (!activation) return c.json({ ok: true, data: { active: false, remaining: 0, code: "" } });
    const row = await db.select().from(inviteCodes).where(eq(inviteCodes.code, activation.code)).get();
    return c.json({ ok: true, data: { active: true, remaining: row?.remaining ?? 0, code: activation.code } });
  });

  return r;
}
