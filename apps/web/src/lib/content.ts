// 内容加载器：构建时用 Node 直接读仓库根 content/ 目录。
// 类型来自 @kaogong/contracts（单一事实源），不在此重复定义——否则会漂移。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DailyDigest, PracticeSet } from "@kaogong/contracts";

export type {
  DailyDigest,
  DigestItem,
  DigestSection,
  PracticeSet,
  Question,
} from "@kaogong/contracts";

// 从 apps/web/src/lib/content.ts 上溯 4 层到仓库根，再进 content/
const CONTENT_DIR = fileURLToPath(new URL("../../../../content/", import.meta.url));

function loadJson<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

/** 列出所有已生成的日报，按日期倒序。 */
export function listDigests(): DailyDigest[] {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR)
    .filter((d) => existsSync(join(CONTENT_DIR, d, "digest.json")))
    .sort()
    .reverse()
    .map((d) => loadJson<DailyDigest>(join(CONTENT_DIR, d, "digest.json"))!)
    .filter(Boolean);
}

/** 按日期取一份日报，不存在返回 null。 */
export function getDigest(date: string): DailyDigest | null {
  return loadJson<DailyDigest>(join(CONTENT_DIR, date, "digest.json"));
}

/** 列出所有每日一练题集，按日期倒序。 */
export function listPracticeSets(): PracticeSet[] {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR)
    .filter((d) => existsSync(join(CONTENT_DIR, d, "practice.json")))
    .sort()
    .reverse()
    .map((d) => loadJson<PracticeSet>(join(CONTENT_DIR, d, "practice.json"))!)
    .filter(Boolean);
}

/** 按日期取一份每日一练题集，不存在返回 null。 */
export function getPracticeSet(date: string): PracticeSet | null {
  return loadJson<PracticeSet>(join(CONTENT_DIR, date, "practice.json"));
}
