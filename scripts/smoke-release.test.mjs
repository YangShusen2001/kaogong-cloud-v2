import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const smokePath = fileURLToPath(new URL("./smoke-release.mjs", import.meta.url));

test("checks deployed public surfaces without mutation", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<a href="/read/article-1">reader</a>');
      return;
    }
    if (request.url === "/read/article-1" || request.url === "/api/ping") {
      response.writeHead(200);
      response.end("ok");
      return;
    }
    if (request.url === "/api/auth/session" || request.url === "/api/subscription") {
      response.writeHead(401);
      response.end("unauthorized");
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const child = spawn(process.execPath, [smokePath], {
    env: { ...process.env, PUBLIC_SITE_URL: baseUrl, PUBLIC_API_BASE: baseUrl },
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [status] = await once(child, "close");
  server.close();

  assert.equal(status, 0, stderr);
  assert.deepEqual(requests, [
    { method: "GET", url: "/" },
    { method: "GET", url: "/read/article-1" },
    { method: "GET", url: "/api/ping" },
    { method: "GET", url: "/api/auth/session" },
    { method: "GET", url: "/api/subscription" },
  ]);
});
