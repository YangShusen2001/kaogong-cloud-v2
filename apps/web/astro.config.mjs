// @ts-check
import { defineConfig } from "astro/config";

// 纯静态站：构建时把所有页面烤成 HTML，部署到 Cloudflare Pages
export default defineConfig({
  output: "static",
  devToolbar: { enabled: false },
});
