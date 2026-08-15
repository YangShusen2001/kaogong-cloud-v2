import type { Favorite, HighlightParagraphListItem, HighlightParagraphResponse, PracticeRecord } from "@kaogong/contracts";
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
    const post = await app.request("/api/favorites", json("POST", { url: "https://x.com/a", title: "t" }));
    const created = await readJson<Favorite>(post);
    const del = await app.request(`/api/favorites/${created.data.id}`, { method: "DELETE", headers: headers() });
    expect(del.status).toBe(200);

    const other = await app.request("/api/favorites", { headers: headers("other-device") });
    expect((await readJson<Favorite[]>(other)).data).toHaveLength(0);
  });
});

describe("highlights", () => {
  const paragraphBody = (baseVersion: number, text = "划线文本") => ({
    articleId: "a1",
    paragraphIndex: 0,
    baseVersion,
    spans: [{ text, note: "备注", styles: ["green", "underline"], start: 0, end: 4 }],
  });

  it("原子保存段落并按文章读取", async () => {
    const app = makeApp();
    const put = await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));
    expect(put.status).toBe(200);
    const saved = await readJson<HighlightParagraphResponse>(put);
    expect(saved.data.version).toBe(1);
    expect(saved.data.highlights[0]?.note).toBe("备注");

    const list = await app.request("/api/highlights/paragraphs/a1", { headers: headers() });
    const data = (await readJson<HighlightParagraphListItem[]>(list)).data;
    expect(data).toHaveLength(1);
    expect(data[0]?.version).toBe(1);
    expect(data[0]?.highlights[0]?.styles).toEqual(["green", "underline"]);
  });

  it("版本递增且陈旧版本不会覆盖已保存数据", async () => {
    const app = makeApp();
    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));
    const second = await app.request("/api/highlights/paragraph", json("PUT", {
      ...paragraphBody(1, "新文本"),
      spans: [{ text: "新文本", note: "", styles: ["yellow"], start: 0, end: 3 }],
    }));
    expect((await readJson<HighlightParagraphResponse>(second)).data.version).toBe(2);

    const stale = await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(1)));
    expect(stale.status).toBe(409);
    const list = await app.request("/api/highlights/paragraphs/a1", { headers: headers() });
    const data = (await readJson<HighlightParagraphListItem[]>(list)).data;
    expect(data[0]?.version).toBe(2);
    expect(data[0]?.highlights[0]?.text).toBe("新文本");
  });

  it("拒绝非法段落状态且按设备隔离", async () => {
    const app = makeApp();
    const invalid = await app.request("/api/highlights/paragraph", json("PUT", {
      ...paragraphBody(0),
      spans: [{ text: "x", note: "", styles: [], start: 0, end: 1 }],
    }));
    expect(invalid.status).toBe(400);

    await app.request("/api/highlights/paragraph", json("PUT", paragraphBody(0)));
    const other = await app.request("/api/highlights/paragraphs/a1", { headers: headers("other-device") });
    expect((await readJson<HighlightParagraphListItem[]>(other)).data).toEqual([]);
  });

  it("旧创建接口返回退役错误", async () => {
    const app = makeApp();
    const post = await app.request("/api/highlights", json("POST", {
      articleId: "a1",
      text: "划线文本",
      styles: ["green", "underline"],
      paragraphIndex: 0,
      start: 0,
      end: 4,
    }));

    expect(post.status).toBe(410);
    expect((await readJson<never>(post)).error?.code).toBe("HIGHLIGHT_API_RETIRED");
  });

  it.each([
    { articleId: "a1", text: "x", paragraphIndex: 0, start: 0, end: 1 },
    { articleId: "a1", text: "x", styles: ["green"], paragraphIndex: 0, start: 3, end: 1 },
  ])("旧创建接口不再校验已退役的请求体", async (body) => {
    const app = makeApp();
    const response = await app.request("/api/highlights", json("POST", body));

    expect(response.status).toBe(410);
    expect((await readJson<never>(response)).error?.code).toBe("HIGHLIGHT_API_RETIRED");
  });

  it("旧删除接口返回退役错误", async () => {
    const app = makeApp();
    const response = await app.request("/api/highlights/legacy-id", { method: "DELETE", headers: headers() });

    expect(response.status).toBe(410);
    expect((await readJson<never>(response)).error?.code).toBe("HIGHLIGHT_API_RETIRED");
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

describe("auth", () => {
  async function login(app: ReturnType<typeof makeApp>, sent: string[], email = "123456@qq.com") {
    const request = await app.request("/api/auth/email/code", json("POST", { email }));
    expect(request.status).toBe(200);
    const code = sent.at(-1)?.match(/\b(\d{6})\b/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const verified = await app.request("/api/auth/email/verify", json("POST", { email, code }));
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    return cookie.split(";")[0]!;
  }

  it("验证码首次登录创建账号并读 session", async () => {
    const sent: string[] = [];
    const app = makeApp({ authSecret: "test-secret", secureCookies: false, verificationMailProvider: { async send(m) { sent.push(m.text); return {}; } } });
    const cookie = await login(app, sent);
    const me = await app.request("/api/auth/session", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await readJson<{ email: string }>(me)).data.email).toBe("123456@qq.com");
  });

  it("验证码不可重放且错误码失败", async () => {
    const sent: string[] = [];
    const app = makeApp({ authSecret: "test-secret", secureCookies: false, verificationMailProvider: { async send(m) { sent.push(m.text); return {}; } } });
    await app.request("/api/auth/email/code", json("POST", { email: "123456@qq.com" }));
    const code = sent[0]!.match(/\b(\d{6})\b/)![1]!;
    const bad = await app.request("/api/auth/email/verify", json("POST", { email: "123456@qq.com", code: "000000" }));
    expect(bad.status).toBe(401);
    const ok = await app.request("/api/auth/email/verify", json("POST", { email: "123456@qq.com", code }));
    expect(ok.status).toBe(200);
    const replay = await app.request("/api/auth/email/verify", json("POST", { email: "123456@qq.com", code }));
    expect(replay.status).toBe(401);
  });

  it("拒绝非 QQ 邮箱且未登录 session 返回 401", async () => {
    const app = makeApp({ authSecret: "test-secret" });
    const request = await app.request("/api/auth/email/code", json("POST", { email: "x@gmail.com" }));
    expect(request.status).toBe(400);
    const res = await app.request("/api/auth/session");
    expect(res.status).toBe(401);
  });

  it("登录后收藏随账号走（跨设备同步，匿名隔离）", async () => {
    const sent: string[] = [];
    const app = makeApp({ authSecret: "test-secret", secureCookies: false, verificationMailProvider: { async send(m) { sent.push(m.text); return {}; } } });
    const cookie = await login(app, sent, "234567@qq.com");

    const authHeaders = {
      "x-device-id": "device-A",
      cookie,
      "content-type": "application/json",
    };
    const add = await app.request("/api/favorites", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ url: "https://x.com/u1", title: "t1" }),
    });
    expect(add.status).toBe(201);

    // 换个设备（device-B），仍带同一 token → 能看到（跨设备同步）
    const list = await app.request("/api/favorites", {
      headers: { "x-device-id": "device-B", cookie },
    });
    expect((await readJson<Favorite[]>(list)).data).toHaveLength(1);

    // 匿名（无 token）看不到账号数据
    const anon = await app.request("/api/favorites", { headers: { "x-device-id": "device-B" } });
    expect((await readJson<Favorite[]>(anon)).data).toHaveLength(0);
  });
});

describe("subscription and newsletter", () => {
  it("订阅后同一期只建一条投递并可发送", async () => {
    const sent: string[] = [];
    const mailProvider = { async send(m: { text: string }) { sent.push(m.text); return {}; } };
    const newsletter = { async send(m: { text: string }) { sent.push(m.text); return { kind: "accepted", providerMessageId: "provider-id" } as const; }, async reconcile() { return { kind: "found", event: "sent" } as const; } };
    const app = makeApp({ authSecret: "secret", jobSecret: "job", publicApiUrl: "https://api.example.com", secureCookies: false, verificationMailProvider: mailProvider, newsletterMailProvider: newsletter });
    await app.request("/api/auth/email/code", json("POST", { email: "345678@qq.com" }));
    const code = sent[0]!.match(/\b(\d{6})\b/)![1]!;
    const verified = await app.request("/api/auth/email/verify", json("POST", { email: "345678@qq.com", code }));
    const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0]!;
    await app.request("/api/subscription", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ subscribed: true }) });
    const issue = { date: "2026-08-14", subject: "每日时政", text: "今日摘要" };
    await app.request("/api/newsletter/issues", { method: "POST", headers: { "x-job-secret": "job", "content-type": "application/json" }, body: JSON.stringify(issue) });
    await app.request("/api/newsletter/issues", { method: "POST", headers: { "x-job-secret": "job", "content-type": "application/json" }, body: JSON.stringify(issue) });
    const processed = await app.request("/api/newsletter/process", { method: "POST", headers: { "x-job-secret": "job" } });
    expect((await readJson<{ processed: number; sent: number }>(processed)).data).toEqual({ processed: 1, sent: 1 });
    const digest = sent.find((text) => text.includes("今日摘要"));
    expect(digest).toContain("https://api.example.com/api/subscription/unsubscribe?token=");
    const token = digest!.split("token=")[1]!;
    const unsubscribe = await app.request(`/api/subscription/unsubscribe?token=${token}`);
    expect(unsubscribe.status).toBe(200);
    const state = await app.request("/api/subscription", { headers: { cookie } });
    expect((await readJson<{ subscribed: boolean }>(state)).data.subscribed).toBe(false);
  });

  it("投递失败进入重试且不影响处理响应", async () => {
    const sent: string[] = [];
    const verification = { async send(m: { text: string }) { sent.push(m.text); return {}; } };
    let attempts = 0;
    const newsletter = { async send() { attempts++; return { kind: "retryable", reason: "provider_unavailable" } as const; }, async reconcile() { return { kind: "retryable" } as const; } };
    const app = makeApp({ authSecret: "secret", jobSecret: "job", publicApiUrl: "https://api.example.com", secureCookies: false, verificationMailProvider: verification, newsletterMailProvider: newsletter });
    await app.request("/api/auth/email/code", json("POST", { email: "456789@qq.com" }));
    const code = sent[0]!.match(/\b(\d{6})\b/)![1]!;
    const verified = await app.request("/api/auth/email/verify", json("POST", { email: "456789@qq.com", code }));
    const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0]!;
    await app.request("/api/subscription", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ subscribed: true }) });
    await app.request("/api/newsletter/issues", { method: "POST", headers: { "x-job-secret": "job", "content-type": "application/json" }, body: JSON.stringify({ date: "2026-08-15", subject: "日报", text: "内容" }) });
    const first = await app.request("/api/newsletter/process", { method: "POST", headers: { "x-job-secret": "job" } });
    expect((await readJson<{ processed: number; sent: number }>(first)).data).toEqual({ processed: 1, sent: 0 });
    expect(attempts).toBe(1);
  });
});
