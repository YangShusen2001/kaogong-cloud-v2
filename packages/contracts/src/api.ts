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
export const highlightSchema = z.object({
  id: z.string(),
  articleId: z.string(),
  text: z.string(),
  note: z.string(),
  createdAt: z.number(), // unix 毫秒
});
export type Highlight = z.infer<typeof highlightSchema>;

export const highlightCreateSchema = z.object({
  articleId: z.string().min(1),
  text: z.string().min(1),
  note: z.string().optional(),
});
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
