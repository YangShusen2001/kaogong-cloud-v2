// 数据库 schema（唯一权威）：收藏 / 划线 / 每日一练。
// 匿名设备标识（device_id）分区用户数据，无账号体系（见 docs/adr/0002）。
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const favorites = sqliteTable("favorites", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(), // unix 毫秒
});

export const highlights = sqliteTable("highlights", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  articleId: text("article_id").notNull(),
  text: text("text").notNull(),
  note: text("note").notNull().default(""),
  style: text("style").notNull().default("yellow"), // yellow | green | underline
  createdAt: integer("created_at").notNull(), // unix 毫秒
});

// 每日一练：每个设备每天一条（复合主键），重复提交即覆盖
export const practice = sqliteTable(
  "practice",
  {
    deviceId: text("device_id").notNull(),
    date: text("date").notNull(), // "YYYY-MM-DD"
    correct: integer("correct").notNull(),
    total: integer("total").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.deviceId, t.date] }),
  }),
);

// 用户：用户名 + PBKDF2 哈希密码（永不存明文）
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  createdAt: integer("created_at").notNull(), // unix 毫秒
});
