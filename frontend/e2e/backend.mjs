// Isolated HTTP fixtures: browser tests never proxy to a user's running backend.
import { createServer } from "node:http";
const authorization = `Basic ${Buffer.from("admin:browser-fixture-password").toString("base64")}`;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://fixture.test").pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  if (path === "/auth/status") {
    response.end(JSON.stringify({ enabled: false }));
    return;
  }
  if (request.headers.authorization !== authorization) {
    response.writeHead(401);
    response.end(JSON.stringify({ detail: "需要认证" }));
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end(JSON.stringify({ detail: "该验收服务只提供只读测试数据" }));
    return;
  }
  if (path === "/api/clips/1/cover") {
    response.setHeader("Content-Type", "image/svg+xml");
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#00aeec"/></svg>',
    );
    return;
  }
  const fixtures = {
    "/api/dashboard": {
      rooms: [],
      live_sources: [],
      counts: { candidates: 0, clips: 0, active_sessions: 0 },
    },
    "/api/jobs": { jobs: [] },
  };
  response.end(JSON.stringify(fixtures[path] || []));
});
server.listen(5196, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
