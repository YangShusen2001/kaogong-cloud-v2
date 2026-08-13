/// <reference types="@cloudflare/workers-types" />
// Worker 入口：把 D1 绑定转成 drizzle 实例，交给 Hono 应用
import { createApp } from "./app";
import type { DB } from "./app";
import { createDb } from "./db";

interface Env {
  DB: D1Database;
  DEEPSEEK_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // D1 与 better-sqlite3 的 Drizzle 类型不同（运行时接口一致），这里做类型收窄
    const db = createDb(env) as unknown as DB;
    return createApp(db, { deepseekKey: env.DEEPSEEK_API_KEY }).fetch(request, env, ctx);
  },
};
