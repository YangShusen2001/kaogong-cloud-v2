// API 契约：apps/web（前端）↔ apps/api（Worker）之间的 HTTP 接口约定。
//
// 用 zod 作为「单一事实源」：TS 类型从 schema 推导（z.infer），
// Worker 侧用同一个 schema 做运行时校验——类型与校验永不漂移。
import { z } from "zod";

// —— 统一响应外壳 ——
export const apiErrorSchema = z.object({
  /** 机器可读错误码，如 "DEVICE_REQUIRED" / "INVALID_INPUT"。 */
  code: z.string(),
  /** 给人看的提示。 */
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// —— 收藏 ——
export const favoriteSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  source: z.string(),
  note: z.string(),
  createdAt: z.number(), // unix 毫秒
});
export type Favorite = z.infer<typeof favoriteSchema>;

export const favoriteCreateSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  source: z.string().optional(),
  note: z.string().optional(),
});
export type FavoriteCreate = z.infer<typeof favoriteCreateSchema>;

// —— 划线 ——
export const highlightStyleSchema = z.enum(["yellow", "green", "underline"]);
export type HighlightStyle = z.infer<typeof highlightStyleSchema>;

export const highlightSchema = z.object({
  id: z.string(),
  articleId: z.string(),
  text: z.string(),
  note: z.string(),
  /** 叠加样式（可同时是荧光笔 + 下划线）。 */
  styles: z.array(highlightStyleSchema).min(1),
  /** 所属段落序号（对应文章的 paragraphs 下标）。 */
  paragraphIndex: z.number().int().min(0),
  /** 段落内起始字符偏移（含）。 */
  start: z.number().int().min(0),
  /** 段落内结束字符偏移（不含），必须大于 start。 */
  end: z.number().int().min(1),
  createdAt: z.number(), // unix 毫秒
});
export type Highlight = z.infer<typeof highlightSchema>;

export const highlightCreateSchema = z
  .object({
    articleId: z.string().min(1),
    text: z.string().min(1),
    note: z.string().optional(),
    styles: z.array(highlightStyleSchema).min(1),
    paragraphIndex: z.number().int().min(0),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
  })
  .refine((v) => v.start < v.end, { message: "划线区间无效（start 必须小于 end）" });
export type HighlightCreate = z.infer<typeof highlightCreateSchema>;

// —— 每日一练 ——
export const practiceRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // "YYYY-MM-DD"
  correct: z.number().int().min(0),
  total: z.number().int().min(1),
});
export type PracticeRecord = z.infer<typeof practiceRecordSchema>;

/** 每日一练提交体与记录同构。 */
export const practiceSubmitSchema = practiceRecordSchema;
export type PracticeSubmit = z.infer<typeof practiceSubmitSchema>;

// —— 划线 AI 解释 ——
export const explainRequestSchema = z.object({
  text: z.string().min(1).max(500),
});
export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const explainResponseSchema = z.object({
  explanation: z.string(),
});
export type ExplainResponse = z.infer<typeof explainResponseSchema>;

// —— 账号鉴权 ——
export const credentialsSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/, "用户名只能含字母数字下划线"),
  password: z.string().min(8).max(64),
  email: z.string().max(64).optional(), // QQ 邮箱，用于订阅通知
  name: z.string().max(32).optional(),  // 姓名
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  username: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// —— 个人资料 ——
export const profileSchema = z.object({
  username: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string(),
  subscribed: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileUpdateSchema = z.object({
  name: z.string().max(32).optional(),
  email: z.string().max(64).optional(),
  avatar: z.string().max(8).optional(),
  subscribed: z.boolean().optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
