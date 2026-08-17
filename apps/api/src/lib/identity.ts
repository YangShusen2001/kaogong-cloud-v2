import type { Context } from "hono";
import type { DB } from "../app";
import { sessionUserId } from "../routes/auth";
import { getDeviceId } from "./device";

export async function resolveOwnerId(c: Context, db: DB): Promise<string | null> {
  const userId = await sessionUserId(c, db);
  return userId ? `user:${userId}` : getDeviceId(c);
}
