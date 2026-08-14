# 提案 0001：阅读页字体/划线修复 与 首页时政分类展示

- **状态**：待评审
- **日期**：2026-08-13
- **范围**：`apps/web`（阅读页 + 首页）、`packages/contracts`（划线契约）、`apps/api`（划线表结构 + 路由）

## 一、问题摘要

阅读页（`apps/web/src/pages/read/[id].astro`）目前存在四类可复现缺陷：

| # | 症状 | 严重度 |
|---|---|---|
| 1 | A− / A＋ 字号调节不生效，正文永远 17px | 高 |
| 2 | 文章字体显示不正常（字号钉死 + 金句不跟随所选字体） | 中 |
| 3 | 划线功能异常：跨节点选区标不上色，但数据已入库（幽灵划线） | 高 |
| 4 | 下划线、荧光笔不能叠加使用 | 高 |

## 二、根因分析

### 问题 1：A− / A＋ 不生效

`read/[id].astro` 的 `setFontSize()` 把字号写到 `<article class="reading">` 的内联样式：

```ts
// read/[id].astro:69-73
function setFontSize(n: number) {
  fontSize = Math.min(26, Math.max(13, n));
  articleEl.style.fontSize = `${fontSize}px`;   // 写到 article 上
  localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
}
```

但正文实际渲染在 `.reading-para` 段落里，而 `global.css` 给段落写死了字号：

```css
/* global.css:497 */
.reading-para { margin: 0 0 var(--s-4); font-size: 17px; line-height: 1.9; text-indent: 2em; }
```

CSS 中「元素自身声明」优先于「从父元素继承的值」：`article` 上的内联 `font-size` 只是待继承值，永远被 `.reading-para` 自己的 `17px` 压过。结果 localStorage 一直在变，页面字号却钉死在 17px。

**结论**：不是 JS 没执行，而是 CSS 声明层级抵消了 JS 的效果。

### 问题 2：文章字体显示不正常

这是问题 1 的连带现象，叠加一个次要缺陷：

- 字号钉死导致整页观感不对（主因）。
- 字体族选择器（宋体/楷体/黑体/瘦金）通过 `articleEl.style.fontFamily` 对 `.reading-para` 生效（继承），但金句 `<blockquote>` 在 `global.css:504` 写死 `font-family: var(--font-serif)`，标题 `.reading-title`（h1）也默认衬线，因此切换字体后金句与标题不跟随，整体观感「不正常」。

### 问题 3：划线功能异常（跨节点选区标不上色）

`wrap()` 用 `Range.surroundContents()` 包裹选区：

```ts
// read/[id].astro:142-151
function wrap(style: Style): HTMLElement | null {
  try {
    const mark = document.createElement("mark");
    mark.className = `hl-${style}`;
    currentRange!.surroundContents(mark);
    return mark;
  } catch {
    return null; // 选区跨节点无法包裹，仅记录不标色
  }
}
```

当选区跨越元素边界（跨段落、跨越已有 `<mark>`、或包含块级元素）时 `surroundContents` 抛异常，被 `catch` 吞掉返回 `null` → 视觉上什么都没标色。但调用方仍无条件入库：

```ts
// read/[id].astro:192-195
if (act === "green" || act === "underline") {
  const mark = wrap(act as Style);
  const res = await api.addHighlight({ articleId, text, style: act as Style }); // 无论 mark 是否为 null 都存库
```

造成「存了但看不见 / 刷新后位置错乱」的幽灵划线：**视觉渲染与持久化不是同一份数据源，二者漂移**。

### 问题 4：下划线、荧光笔不能叠加

数据模型与渲染两层限制共同导致：

- **契约**：`packages/contracts/src/api.ts:36` 把样式定义为单值枚举 `z.enum(["yellow", "green", "underline"])`，一条划线只能有一种样式，无法表达「绿色荧光笔 + 下划线」。
- **数据库**：`apps/api/src/db/schema.ts:21` 的 `highlights.style` 是单列文本，同样只能存一种。
- **渲染**：每条高亮只包一个 `<mark class="hl-xxx">`，`hl-green` 与 `hl-underline` 是互斥类；对已高亮文字再选下划线，选区会部分跨越 `<mark>` 边界 → 又落入问题 3 的 `surroundContents` 异常 → 视觉不生效（但又被存库）。

### 深层缺陷：划线定位依赖「文本首次出现匹配」

`applyHighlight()`（`read/[id].astro:244-268`）回填已有划线时，只用 `text` 在段落 `textContent` 里做**首次出现**匹配，不存偏移/段落序号：

- 同一句话在段落中出现两次 → 永远只标第一处。
- 高亮文本被上一个 `<mark>` 切分成多个文本节点后 → 找不到单一文本节点，静默失败。
- 无法表达重叠/相邻的样式叠加。

这是「划线异常」与「不能叠加」的共同根源：缺少稳定的定位信息（段落序号 + 字符偏移），且样式是单值而非集合。

## 三、修复方案

### A. 字体（纯前端，低风险）

1. `global.css`：
   - 给 `.reading` 增加默认字号 `font-size: 17px`（作为 JS 内联样式的兜底）。
   - 删除 `.reading-para` 里的 `font-size: 17px`，让其继承 `.reading` 的内联字号。
   - 把 `.reading blockquote` 的 `font-family: var(--font-serif)` 改为 `inherit`，让金句跟随所选字体。
2. `read/[id].astro` 的 `setFontSize`/`setFont` 逻辑不变，改动最小。

### B. 划线数据模型（契约 + DB + API）

1. **契约**（`packages/contracts/src/api.ts`）：
   - `highlightSchema` 增加 `styles: highlightStyleSchema.array().min(1)`，替代单值 `style`（或与其并存，见「迁移」）。
   - 增加定位字段：`paragraphIndex: number`、`start: number`、`end: number`（段落内字符偏移，用于稳定回填与叠加）。
   - `highlightCreateSchema` 同步增加对应字段。
2. **数据库**（`apps/api/src/db/schema.ts`）：
   - `highlights` 表新增 `styles`（JSON 文本）、`paragraph_index`、`start_offset`、`end_offset` 列；产出 drizzle 迁移 `0005`。
3. **API**（`apps/api/src/routes/highlights.ts`）：
   - POST 校验并写入新字段；GET 返回新字段。

### C. 划线渲染（前端，数据驱动重渲染）

放弃 `surroundContents` 包裹选区，改为「以偏移为源、统一重渲染」：

1. 阅读页保留段落原文（`article.paragraphs` 已在构建期可得）。
2. 选区 → 计算所在段落序号 + 段落内字符偏移 → 随样式写入 `addHighlight` → 触发重渲染。
3. 重渲染：把每个段落的所有划线区间按偏移合并；同一区间的样式求并集（如 `hl-green hl-underline`），跨区间自动切分。用 `<mark>` 一次性铺排，天然支持叠加与重叠。
4. 删除：从区间移除该样式（或整条删除）→ 重渲染。
5. 回填（原 `applyHighlight`）走同一条重渲染路径，消除「首次出现匹配 / 跨节点失败」。

### D. 迁移与兼容

- 项目尚未上线（`README.md` 状态第 6 项未勾选），D1 无生产数据，可做破坏性迁移：新增 `0005` 迁移，回填旧 `style` 到 `styles`（单元素数组），旧行无偏移字段的按「文本首次出现」做一次性兜底回填或标记为「待重新定位」。
- 若想临时兼容旧客户端，契约可同时保留 `style`（只读派生成 `styles[0]`），前端新代码只读写 `styles`。

### E. 测试

- **API**（`apps/api/test/api.test.ts`）：新增「叠加样式创建/列出/删除」「非法偏移/空样式数组返回 400」用例。
- **前端**：补阅读页交互测试——A−/A＋ 改变 `.reading-para` 的计算字号；叠加高亮（荧光笔 + 下划线）渲染为同区间并集类。

## 四、影响与风险

- **好**：字体调节真正生效；划线定位稳定、可叠加、回填不再丢；视觉渲染与持久化收敛为同一份数据。
- **代价**：划线从「文本匹配」升级为「偏移定位」涉及契约/DB/前端三处联动，改动面大于纯 CSS 修复。
- **风险**：段落内容更新后旧偏移可能失效（管道重抓原文时）。缓解：回填时校验偏移处文本是否仍与 `text` 一致，不一致则降级为首次出现匹配或跳过。

## 五、验收标准

1. 点 A−/A＋ 时 `.reading-para` 的计算字号在 13–26px 间变化，刷新后保持。
2. 切换 宋体/楷体/黑体/瘦金，正文与金句均跟随。
3. 选中跨段落文本划线不再出现「存了但看不见」的幽灵划线。
4. 对同一段文字可同时叠加「荧光笔（绿）+ 下划线」，刷新后仍正确渲染。
5. 同一段落出现两处相同文字时，划线定位到用户实际选中的那一处。

## 六、首页时政分类展示（新增需求）

### 现状

- 数据已分类：`content/*/digest.json` 的 `sections[]` 每节带 `id` 与 `title`；当前 `2026-08-13` 已含「全国时政要闻 / 申论精读 / 广东要闻动态 / 四川要闻动态 / 江苏要闻动态 / 今日谈 / 南方时评」七类，契约 `DigestSection` 已具备 `id/title/items` 字段，数据侧无需改动。
- 日报页 `apps/web/src/pages/daily/[date].astro` 已按分类分组渲染（`.section` + `<h2>`）。
- 首页 `apps/web/src/pages/index.astro` 尚未体现分类：
  - 轮播 `carouselItems`（第 10–20 行）用 `flatMap(...).slice(0, 6)` 展平后丢失分类，标签写死「今日要闻」（第 45 行）。
  - 「今日时政 · {date}」卡片（第 55–70 行）是扁平列表，分类仅作 `.item-sec` 小标签，无分组标题。

### 方案

1. **轮播带分类标签**：`carouselItems` 映射时保留所属分类 `section: s.title`；`<span class="carousel-tag">` 由写死的「今日要闻」改为渲染 `{it.section}`（如「全国时政要闻」「广东要闻动态」）。
2. **今日时政卡片按分类分组**：把扁平列表改为按 `latest.sections` 分组渲染，复用日报页的 `.section`/`h3` 结构——每个分类一个标题（全国时政要闻、广东要闻动态……），其下渲染该分类条目；保留「有剪藏跳阅读页、否则跳原文」逻辑。
3. **顺序**：分类顺序遵循 `digest.sections` 原始顺序，不重排；无条目的分类不渲染标题。

### 验收标准

1. 首页「今日时政 · 2026-08-13」按分类分组，能看到「全国时政要闻」「广东要闻动态」「四川要闻动态」等分类标题，条目归入对应分类。
2. 轮播每张 slide 左上角标签显示其所属分类（如「全国时政要闻」「广东要闻动态」），不再是统一的「今日要闻」。
3. 分类标题与 `digest.sections[].title` 一致；无条目的分类不出现空标题。

## 七、边界（本次不做）

- 注释（note）的展示 UI：当前「注释」划线只存不展示，另行提案。
- 跨段落重叠划线的复杂合并策略：先支持单段落内叠加，跨段落作为一个段落区间各自渲染。
