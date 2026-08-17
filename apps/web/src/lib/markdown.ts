// Markdown 渲染：AI 解释文本 → 安全 HTML。
// 先用 marked 渲染，再用 DOMPurify 消毒，防止 AI 输出里的 HTML/XSS 注入。
import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
