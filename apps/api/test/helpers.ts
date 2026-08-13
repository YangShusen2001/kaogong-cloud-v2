// 测试辅助：内存 SQLite（better-sqlite3）+ 应用迁移，产出一个可请求的 Hono app
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { createApp, type AppConfig } from "../src/app";
import * as schema from "../src/db/schema";

export function makeApp(config: AppConfig = {}) {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return createApp(db, config);
}

export const DEVICE = "test-device-1234";

export function headers(device: string = DEVICE, extra: Record<string, string> = {}) {
  return { "x-device-id": device, ...extra };
}

export function json(method: string, body: unknown, device: string = DEVICE) {
  return {
    method,
    headers: headers(device, { "content-type": "application/json" }),
    body: JSON.stringify(body),
  };
}

// workers-types 的 Response.json() 返回 unknown，这里显式标注 ApiEnvelope 形状
export interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

export async function readJson<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}
