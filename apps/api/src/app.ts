// Hono 应用工厂：注入 drizzle 实例（生产传 D1，测试传 better-sqlite3）
import { Hono } from "hono";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import { favoritesRoutes } from "./routes/favorites";
import { highlightsRoutes } from "./routes/highlights";
import { practiceRoutes } from "./routes/practice";
import { explainRoutes } from "./routes/explain";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";

export type DB = BetterSQLite3Database<typeof schema>;

export interface AppConfig {
  deepseekKey?: string;
  authSecret?: string;
}

export function createApp(db: DB, config: AppConfig = {}) {
  const app = new Hono();
  app.get("/api/ping", (c) => c.json({ ok: true, data: "pong" }));
  app.route("/api/auth", authRoutes(db, config));
  app.route("/api/profile", profileRoutes(db, config));
  app.route("/api/favorites", favoritesRoutes(db, config));
  app.route("/api/highlights", highlightsRoutes(db, config));
  app.route("/api/practice", practiceRoutes(db, config));
  app.route("/api/explain", explainRoutes(config));
  return app;
}
