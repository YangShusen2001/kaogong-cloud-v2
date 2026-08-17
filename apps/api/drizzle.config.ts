// drizzle-kit 配置：从 src/db/schema.ts 生成 SQL 迁移到 drizzle/ 目录
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
