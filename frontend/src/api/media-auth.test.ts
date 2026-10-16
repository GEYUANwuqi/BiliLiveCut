// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
it("scopes Basic media credentials to one client and keeps Range requests", async () => {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const fetch = vi.fn().mockResolvedValue(new Response("video"));
  const origin = "https://example.test";
  const self = {
    location: { origin },
    addEventListener: (
      kind: string,
      handler: (event: Record<string, unknown>) => void,
    ) => {
      handlers[kind] = handler;
    },
  };
  runInNewContext(
    readFileSync(
      new URL("../../public/media-auth.js", import.meta.url),
      "utf8",
    ),
    { self, URL, Headers, Request, Map, fetch },
  );
  handlers.message({
    source: { id: "tab-1", url: `${origin}/review/1` },
    data: { type: "blc:media-auth", authorization: "Basic private" },
  });
  const respondWith = vi.fn();
  handlers.fetch({
    request: new Request(`${origin}/api/clips/1/video`, {
      headers: { Range: "bytes=0-99" },
      mode: "no-cors",
    }),
    clientId: "tab-1",
    respondWith,
  });
  expect(respondWith).toHaveBeenCalledOnce();
  const forwarded = fetch.mock.calls[0][0] as Request;
  expect(forwarded.mode).toBe("same-origin");
  expect(forwarded.headers.get("Authorization")).toBe("Basic private");
  expect(forwarded.headers.get("Range")).toBe("bytes=0-99");
  for (const [client, url] of [
    ["tab-2", `${origin}/api/clips/1/video`],
    ["tab-1", "https://other.test/api/clips/1/video"],
    ["tab-1", `${origin}/api/dashboard`],
  ]) {
    respondWith.mockClear();
    handlers.fetch({
      request: new Request(url),
      clientId: client,
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  }
  handlers.message({
    source: { id: "tab-1", url: `${origin}/` },
    data: { type: "blc:media-auth", authorization: "" },
  });
  respondWith.mockClear();
  handlers.fetch({
    request: new Request(`${origin}/api/clips/1/video`),
    clientId: "tab-1",
    respondWith,
  });
  expect(respondWith).not.toHaveBeenCalled();
});
