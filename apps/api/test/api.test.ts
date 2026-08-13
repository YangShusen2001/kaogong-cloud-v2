import { describe, expect, it } from "vitest";
import { headers, json, makeApp, readJson } from "./helpers";

interface Favorite {
  id: string;
  url: string;
  title: string;
  source: string;
  note: string;
  createdAt: number;
}
interface Highlight {
  id: string;
  articleId: string;
  text: string;
  note: string;
  createdAt: number;
}
interface Practice {
  date: string;
  correct: number;
  total: number;
}

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
    const data = (await readJson<Practice[]>(list)).data;
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
