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
  url: z.string().min(1).regex(/^https?:\/\//i, "url 必须以 http(s):// 开头"),
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

export const highlightSpanSchema = z.object({
  text: z.string().min(1).max(1000),
  note: z.string().max(2000).default(""),
  styles: z.array(highlightStyleSchema).min(1).max(3),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
}).refine((v) => v.start < v.end, { message: "划线区间无效（start 必须小于 end）" });
export type HighlightSpan = z.infer<typeof highlightSpanSchema>;

export const highlightParagraphReplaceSchema = z.object({
  articleId: z.string().min(1),
  paragraphIndex: z.number().int().min(0),
  baseVersion: z.number().int().min(0),
  spans: z.array(highlightSpanSchema).max(100),
});
export type HighlightParagraphReplace = z.infer<typeof highlightParagraphReplaceSchema>;

export const highlightParagraphResponseSchema = z.object({
  version: z.number().int().min(0),
  highlights: z.array(highlightSchema),
});
export type HighlightParagraphResponse = z.infer<typeof highlightParagraphResponseSchema>;

export const highlightParagraphListItemSchema = highlightParagraphResponseSchema.extend({
  paragraphIndex: z.number().int().min(0),
});
export type HighlightParagraphListItem = z.infer<typeof highlightParagraphListItemSchema>;

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

// —— QQ 邮箱验证码鉴权 ——
export const qqEmailSchema = z.string().trim().toLowerCase()
  .regex(/^[1-9][0-9]{4,10}@qq\.com$/, "请输入有效的 QQ 邮箱");
export const emailCodeRequestSchema = z.object({ email: qqEmailSchema });
export type EmailCodeRequest = z.infer<typeof emailCodeRequestSchema>;
export const emailCodeVerifySchema = z.object({
  email: qqEmailSchema,
  code: z.string().regex(/^\d{6}$/, "验证码必须为 6 位数字"),
});
export type EmailCodeVerify = z.infer<typeof emailCodeVerifySchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: qqEmailSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// —— 个人资料 ——
export const profileSchema = z.object({
  name: z.string(),
  email: qqEmailSchema,
  avatar: z.string(),
  subscribed: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileUpdateSchema = z.object({
  name: z.string().max(32).optional(),
  avatar: z.string().min(1).max(8).optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const subscriptionSchema = z.object({ subscribed: z.boolean() });
export type Subscription = z.infer<typeof subscriptionSchema>;

export const subscriptionResponseSchema = z.object({
  subscribed: z.boolean(),
  deliveryAvailable: z.boolean(),
  suppressionReason: z.string().nullable(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;
