// 登录 token 管理：JWT 存 localStorage，客户端解 payload 拿用户名（不联网）。
const TOKEN_KEY = "kaogong.token.v1";

export function getToken(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(t: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

/** 从 JWT payload 解出 username（仅供顶栏即时显示，真正的鉴权在服务端）。 */
export function tokenUsername(): string {
  const t = getToken();
  if (!t) return "";
  try {
    const payload = t.split(".")[1] ?? "";
    const obj = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { username?: string };
    return typeof obj.username === "string" ? obj.username : "";
  } catch {
    return "";
  }
}
