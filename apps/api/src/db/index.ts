// 生产路径：从 Worker 环境变量里的 D1 绑定创建 drizzle 实例
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}
