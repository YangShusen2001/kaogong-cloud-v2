// 解析数据归属：登录了用 userId（跨设备同步），否则回退匿名设备 id
import type { Context } from "hono";
import { verifyToken } from "./auth";
import { getDeviceId } from "./device";

export async function resolveOwnerId(c: Context, secret: string): Promise<string | null> {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const payload = await verifyToken(auth.slice(7).trim(), secret);
    if (payload) return payload.sub; // userId
  }
  return getDeviceId(c); // 匿名设备 id
}
