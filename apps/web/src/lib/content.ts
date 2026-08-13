// 内容加载器：构建时用 Node 直接读仓库根 content/ 目录。
// 这是「管道 → 前端」契约边界的消费端：只认 content/ 里的 JSON，不认识 Python 实现。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 从 apps/web/src/lib/content.ts 上溯 4 层到仓库根，再进 content/
const CONTENT_DIR = fileURLToPath(new URL("../../../../content/", import.meta.url));

/** 与 content/schema/digest.schema.json 对齐的日报类型（消费端视图）。 */
export interface DigestItem {
  title: string;
  date: string;
  sourceUrl: string;
  quotes?: string[];
}
export interface DigestSection {
  id: string;
  title: string;
  items: DigestItem[];
}
export interface DailyDigest {
  date: string;
  title: string;
  sections: DigestSection[];
}

/** 列出所有已生成的日报，按日期倒序。 */
export function listDigests(): DailyDigest[] {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR)
    .filter((d) => existsSync(join(CONTENT_DIR, d, "digest.json")))
    .sort()
    .reverse()
    .map((d) => JSON.parse(readFileSync(join(CONTENT_DIR, d, "digest.json"), "utf-8")) as DailyDigest);
}

/** 按日期取一份日报，不存在返回 null。 */
export function getDigest(date: string): DailyDigest | null {
  const p = join(CONTENT_DIR, date, "digest.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as DailyDigest;
}
