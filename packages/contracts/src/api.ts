// API 契约：apps/web（前端）↔ apps/api（Worker）之间的 HTTP 接口约定。
// 现在只定义形状；阶段 4 实现 Worker 时按此契约落路由与校验。

/** 机器可读错误码 + 给人看的提示。 */
export interface ApiError {
  /** 如 "AUTH_REQUIRED" / "NOT_FOUND"。 */
  code: string;
  message: string;
}

/** 所有接口的统一响应外壳。 */
export interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  error?: ApiError;
}

// —— 核心资源（阶段 4；匿名设备标识，无账号体系）——

/** 收藏的原文/摘录。 */
export interface Favorite {
  id: string;
  /** 原文链接。 */
  url: string;
  title: string;
  source: string;
  /** 用户备注。 */
  note: string;
  createdAt: string;
}

/** 划线记录。 */
export interface Highlight {
  id: string;
  /** 对应 ClippedArticle.id。 */
  articleId: string;
  /** 划线原文。 */
  text: string;
  note: string;
  createdAt: string;
}

/** 每日一练答题记录。 */
export interface PracticeRecord {
  /** "2026-08-13"。 */
  date: string;
  correct: number;
  total: number;
}
