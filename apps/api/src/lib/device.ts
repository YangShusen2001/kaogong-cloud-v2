// 匿名设备标识：前端生成 uuid 存 localStorage，每次请求带 X-Device-Id 头
import type { Context } from "hono";

const DEVICE_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function getDeviceId(c: Context): string | null {
  const id = c.req.header("x-device-id");
  if (!id || !DEVICE_RE.test(id)) return null;
  return id;
}
