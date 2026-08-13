import type { Favorite, Highlight, PracticeRecord } from "@kaogong/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headers, json, makeApp, readJson } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("favorites", () => {
  it("创建后能按设备列出", async () => {
    const app = makeApp();
    const post = await app.request("/api/favorites", json("POST", { url: "https://x.com/a", title: "标题" }));
    expect(post.status).toBe(201);
    const created = await readJson<Favorite>(post);
    expect(created.data.title).toBe("标题");

    const list = await app.request("/api/favorites", { headers: headers() });
    const data = (await readJson<Favorite[]>(list)).data;
    expect(data).toHaveLength(1);
    expect(data[0]?.url).toBe("https://x.com/a");
  });

  it("缺少设备标识返回 400", async () => {
    const app = makeApp();
    const res = await app.request("/api/favorites");
    expect(res.status).toBe(400);
  });

  it("缺少 title 返回 400", async () => {
    const app = makeApp();
    const res = await app.request("/api/favorites", json("POST", { url: "https://x.com/a" }));
    expect(res.status).toBe(400);
  });

  it("删除只影响自己设备的数据", async () => {
    const app = makeApp();
    const post = await app.request("/api/favorites", json("POST", { url: "u", title: "t" }));
    const created = await readJson<Favorite>(post);
    const del = await app.request(`/api/favorites/${created.data.id}`, { method: "DELETE", headers: headers() });
    expect(del.status).toBe(200);

    const other = await app.request("/api/favorites", { headers: headers("other-device") });
    expect((await readJson<Favorite[]>(other)).data).toHaveLength(0);
  });
});

describe("highlights", () => {
  it("创建并列出划线", async () => {
    const app = makeApp();
    await app.request("/api/highlights", json("POST", { articleId: "a1", text: "划线文本" }));
    const list = await app.request("/api/highlights", { headers: headers() });
    const data = (await readJson<Highlight[]>(list)).data;
    expect(data).toHaveLength(1);
    expect(data[0]?.articleId).toBe("a1");
  });
});

describe("practice", () => {
  it("同一设备同一天只留一条（upsert 覆盖）", async () => {
    const app = makeApp();
    await app.request("/api/practice", json("POST", { date: "2026-08-12", correct: 3, total: 5 }));
    await app.request("/api/practice", json("POST", { date: "2026-08-12", correct: 5, total: 5 }));
    const list = await app.request("/api/practice", { headers: headers() });
    const data = (await readJson<PracticeRecord[]>(list)).data;
    expect(data).toHaveLength(1);
    expect(data[0]?.correct).toBe(5);
  });

  it("日期格式非法返回 400", async () => {
    const app = makeApp();
    const res = await app.request("/api/practice", json("POST", { date: "08-12", correct: 1, total: 5 }));
    expect(res.status).toBe(400);
  });
});

describe("ping", () => {
  it("健康检查无需设备标识", async () => {
    const app = makeApp();
    const res = await app.request("/api/ping");
    expect((await readJson<string>(res)).data).toBe("pong");
  });
});

describe("explain", () => {
  it("调用 DeepSeek 返回解释", async () => {
    const app = makeApp({ deepseekKey: "k" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "这句指高质量发展是首要任务。" } }] }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const res = await app.request("/api/explain", json("POST", { text: "高质量发展" }));
    expect(res.status).toBe(200);
    expect((await readJson<{ explanation: string }>(res)).data.explanation).toContain("高质量发展");
  });

  it("未配置 key 返回 503", async () => {
    const app = makeApp();
    const res = await app.request("/api/explain", json("POST", { text: "高质量发展" }));
    expect(res.status).toBe(503);
  });
});

interface AuthData {
  token: string;
  user: { id: string; username: string };
}

describe("auth", () => {
  const creds = { username: "alice", password: "password123" };

  it("注册后能登录并读 me", async () => {
    const app = makeApp({ authSecret: "test-secret" });
    const reg = await app.request("/api/auth/register", json("POST", creds));
    expect(reg.status).toBe(201);
    const regData = await readJson<AuthData>(reg);
    expect(regData.data.user.username).toBe("alice");

    const me = await app.request("/api/auth/me", {
      headers: { authorization: `Bearer ${regData.data.token}` },
    });
    expect(me.status).toBe(200);
    expect((await readJson<{ username: string }>(me)).data.username).toBe("alice");
  });

  it("重复注册返回 409", async () => {
    const app = makeApp({ authSecret: "test-secret" });
    await app.request("/api/auth/register", json("POST", creds));
    const dup = await app.request("/api/auth/register", json("POST", creds));
    expect(dup.status).toBe(409);
  });

  it("密码错误返回 401", async () => {
    const app = makeApp({ authSecret: "test-secret" });
    await app.request("/api/auth/register", json("POST", creds));
    const bad = await app.request("/api/auth/login", json("POST", { ...creds, password: "wrongpass99" }));
    expect(bad.status).toBe(401);
  });

  it("未登录读 me 返回 401", async () => {
    const app = makeApp({ authSecret: "test-secret" });
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
