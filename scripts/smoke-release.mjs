const siteUrl = process.env.PUBLIC_SITE_URL;
const apiUrl = process.env.PUBLIC_API_BASE;

if (!siteUrl || !apiUrl) {
  console.error("PUBLIC_SITE_URL and PUBLIC_API_BASE are required");
  process.exitCode = 2;
} else {
  const siteBase = new URL(siteUrl);
  const apiBase = new URL(apiUrl);
  const request = async (url, acceptedStatuses) => {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!acceptedStatuses.includes(response.status)) {
      throw new Error(`${url.pathname} returned ${response.status}`);
    }
    return response;
  };

  try {
    const home = await request(new URL("/", siteBase), [200]);
    const html = await home.text();
    const readerHref = html.match(/href=["']([^"']*\/read\/[^"'#?]+)["']/)?.[1];
    if (!readerHref) throw new Error("home page has no reader link");
    await request(new URL(readerHref, siteBase), [200]);
    await request(new URL("/api/ping", apiBase), [200]);
    await request(new URL("/api/auth/session", apiBase), [200, 401]);
    await request(new URL("/api/subscription", apiBase), [200, 401]);
    console.log("remote smoke passed: home, reader, API, auth, subscription");
  } catch (error) {
    console.error(`remote smoke failed: ${error instanceof Error ? error.message : "UnknownError"}`);
    process.exitCode = 1;
  }
}
