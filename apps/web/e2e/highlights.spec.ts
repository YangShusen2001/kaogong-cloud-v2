import { expect, test, type Page } from "@playwright/test";
import { stubAnonymousSession } from "./helpers";

const ARTICLE = "/read/14588442ca/";
const KEY = "kaogong.highlights.v1.14588442ca";

/** 在页面脚本运行前预置本地划线（等价于用户此前已划线）。 */
function seedHighlight(page: Page, explanation: string) {
  return page.addInitScript(({ key, explanation }) => {
    localStorage.setItem(key, JSON.stringify([
      { paragraphIndex: 0, start: 0, end: 6, styles: ["underline"], note: "", explanation },
    ]));
  }, { key: KEY, explanation });
}

test("元素锚定的选区（三击整段/缩进空白拖选）能触发划线工具栏", async ({ page }) => {
  await stubAnonymousSession(page);
  await page.goto(ARTICLE);
  const paragraph = page.locator(".reading-para").first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((element) => {
    const text = element.firstChild as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(element, 0); // 元素节点作为 startContainer（三击/从缩进空白拖选）
    range.setEnd(text, Math.min(8, text.textContent!.length));
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.locator("#hl-toolbar")).toBeVisible();
});

test("加粗按钮应用 bold 样式", async ({ page }) => {
  await stubAnonymousSession(page);
  await page.goto(ARTICLE);
  const paragraph = page.locator(".reading-para").first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((element) => {
    const text = element.firstChild as Text;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const toolbar = page.locator("#hl-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "加粗" }).click();
  await expect(paragraph.locator("mark.hl-bold")).toHaveCount(1);
});

test("悬停带 AI 解释的划线显示共享 tooltip（含 Markdown）", async ({ page }) => {
  await stubAnonymousSession(page);
  await seedHighlight(page, "**加粗**的解释");
  await page.goto(ARTICLE);

  const explained = page.locator('mark[data-explanation="**加粗**的解释"]');
  await expect(explained).toBeVisible();
  await explained.hover();
  await expect(page.locator(".annotation-tip strong")).toContainText("加粗");
});

test("tooltip 悬停常驻：移入不消失，移出才消失", async ({ page }) => {
  await stubAnonymousSession(page);
  await seedHighlight(page, "这是一段解释");
  await page.goto(ARTICLE);

  const explained = page.locator('mark[data-explanation="这是一段解释"]');
  await expect(explained).toBeVisible();
  await explained.hover();
  const tip = page.locator(".annotation-tip");
  await expect(tip).toBeVisible();

  // 把鼠标移到 tooltip 上，tooltip 应保持可见（不消失）
  const box = await tip.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(tip).toBeVisible();

  // 移开到页面空白处，tooltip 才消失
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
});

test("悬停 AI 解释划线时「去除」与 tooltip 上下分离", async ({ page }) => {
  await stubAnonymousSession(page);
  await seedHighlight(page, "解释");
  await page.goto(ARTICLE);

  const explained = page.locator('mark[data-explanation="解释"]');
  await expect(explained).toBeVisible();
  await explained.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await explained.hover();

  const removeBtn = page.locator(".hl-remove");
  const tip = page.locator(".annotation-tip");
  await expect(removeBtn).toBeVisible();
  await expect(tip).toBeVisible();

  const rb = await removeBtn.boundingBox();
  const tb = await tip.boundingBox();
  expect(rb).not.toBeNull();
  expect(tb).not.toBeNull();
  // 「去除」与 tooltip 纵向不重叠（一个在上、一个在下）
  const separated = rb!.y + rb!.height <= tb!.y || tb!.y + tb!.height <= rb!.y;
  expect(separated).toBe(true);
});

test("划线保存到本地并在刷新后恢复", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubAnonymousSession(page);
  await page.goto(ARTICLE);
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
  await toolbar.getByRole("button", { name: "荧光笔" }).click();
  expect(pageErrors).toEqual([]);
  await expect(toolbar).toHaveAttribute("data-state", "saved");
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
  await toolbar.getByRole("button", { name: "下划线" }).click();
  const combined = restored.locator("mark.hl-green.hl-underline");
  await expect(combined).toHaveCount(1);

  await combined.hover();
  const removeBtn = page.locator(".hl-remove");
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();
  await expect(restored.locator("mark.hl-green")).toHaveCount(0);
  await expect(restored.locator("mark.hl-underline")).toHaveCount(0);
});
