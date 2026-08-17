import type { Page } from "@playwright/test";

export async function stubAnonymousSession(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 401,
      json: { ok: false, data: null, error: { code: "AUTH_REQUIRED", message: "未登录" } },
    }),
  );
}
