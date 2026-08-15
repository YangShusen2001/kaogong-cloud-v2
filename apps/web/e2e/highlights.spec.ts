import { expect, test } from "@playwright/test";
import { stubAnonymousSession } from "./helpers";

test("划线原子保存并在刷新后恢复", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubAnonymousSession(page);
  let version = 0;
  let spans: Array<{ text: string; note: string; styles: string[]; start: number; end: number }> = [];

  await page.route("**/api/highlights/paragraphs/*", async (route) => {
    const articleId = route.request().url().split("/").pop()!;
    await route.fulfill({
      json: {
        ok: true,
        data: spans.length ? [{
          paragraphIndex: 0,
          version,
          highlights: spans.map((span, index) => ({
            id: `${articleId}:0:${version}:${index}`,
            articleId,
            paragraphIndex: 0,
            createdAt: Date.now(),
            ...span,
          })),
        }] : [],
      },
    });
  });
  await page.route("**/api/highlights/paragraph", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.baseVersion).toBe(version);
    version += 1;
    spans = body.spans;
    await route.fulfill({
      json: {
        ok: true,
        data: {
          version,
          highlights: spans.map((span, index) => ({
            id: `${body.articleId}:0:${version}:${index}`,
            articleId: body.articleId,
            paragraphIndex: 0,
            createdAt: Date.now(),
            ...span,
          })),
        },
      },
    });
  });

  await page.goto("/read/14588442ca/");
  const paragraph = page.locator(".reading-para").first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((element) => {
    const text = element.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(8, text.textContent!.length));
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const toolbar = page.locator("#hl-toolbar");
  await expect(toolbar).toBeVisible();
  const saved = page.waitForRequest((request) => request.url().endsWith("/api/highlights/paragraph") && request.method() === "PUT");
  await toolbar.getByRole("button", { name: "荧光笔" }).click();
  expect(pageErrors).toEqual([]);
  await expect(toolbar).toHaveAttribute("data-state", "saved");
  await saved;
  await expect(paragraph.locator("mark.hl-green")).toHaveCount(1);

  await page.reload();
  const restored = page.locator(".reading-para").first();
  await expect(restored.locator("mark.hl-green")).toHaveCount(1);

  await restored.locator("mark.hl-green").evaluate((element) => {
    const text = element.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(toolbar).toBeVisible();
  const underlined = page.waitForRequest((request) => request.url().endsWith("/api/highlights/paragraph") && request.method() === "PUT");
  await toolbar.getByRole("button", { name: "下划线" }).click();
  await underlined;
  const combined = restored.locator("mark.hl-green.hl-underline");
  await expect(combined).toHaveCount(1);

  await combined.click();
  const removeUnderline = page.getByRole("button", { name: "移除下划线" });
  await expect(removeUnderline).toBeVisible();
  const removed = page.waitForRequest((request) => request.url().endsWith("/api/highlights/paragraph") && request.method() === "PUT");
  await removeUnderline.click();
  await removed;
  await expect(restored.locator("mark.hl-green")).toHaveCount(1);
  await expect(restored.locator("mark.hl-underline")).toHaveCount(0);
});
