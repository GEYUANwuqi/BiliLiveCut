// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const origin = "https://example.test";
const token = "Basic cHJpdmF0ZQ==";
interface PageClient {
  url: string;
  postMessage: (message: unknown, ports: MessagePort[]) => void;
}
function worker(pages: Map<string, PageClient>) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const fetch = vi.fn().mockResolvedValue(new Response("video"));
  const get = vi.fn(async (id: string) => pages.get(id));
  runInNewContext(
    readFileSync(
      new URL("../../public/media-auth.js", import.meta.url),
      "utf8",
    ),
    {
      self: {
        location: { origin },
        clients: { get },
        addEventListener: (
          kind: string,
          callback: (event: unknown) => void,
        ) => {
          handlers[kind] = callback;
        },
      },
      URL,
      Headers,
      Request,
      MessageChannel,
      setTimeout,
      clearTimeout,
      fetch,
    },
  );
  return {
    get,
    fetch,
    request(
      clientId = "tab-1",
      path = "/api/clips/1/video",
      options: RequestInit = {},
    ) {
      let response: Promise<Response> | undefined;
      handlers.fetch({
        clientId,
        request: new Request(new URL(path, origin), options),
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      return response;
    },
  };
}
function page(authorization: unknown): PageClient {
  return {
    url: `${origin}/review/1`,
    postMessage: (_message, ports) => ports[0].postMessage({ authorization }),
  };
}

it("recovers credentials after a fresh worker starts and preserves native Range requests", async () => {
  const pages = new Map([
    ["tab-1", page(token)],
    ["tab-2", page("")],
  ]);
  for (let restart = 0; restart < 2; restart++) {
    const current = worker(pages);
    await current.request("tab-1", "/api/clips/1/video", {
      headers: { Range: "bytes=0-99" },
      mode: "no-cors",
    });
    const forwarded = current.fetch.mock.calls[0][0] as Request;
    expect(forwarded.mode).toBe("same-origin");
    expect(forwarded.cache).toBe("no-store");
    expect(forwarded.headers.get("Authorization")).toBe(token);
    expect(forwarded.headers.get("Range")).toBe("bytes=0-99");
    await current.request("tab-2");
    expect(current.get.mock.calls).toEqual([["tab-1"], ["tab-2"]]);
    expect(
      (current.fetch.mock.calls.at(-1)![0] as Request).headers.has(
        "Authorization",
      ),
    ).toBe(false);
  }
});

it("does not retain credentials after the source page logs out", async () => {
  const pages = new Map([["tab-1", page(token)]]);
  const current = worker(pages);
  await current.request();
  pages.set("tab-1", page(""));
  await current.request();
  expect(
    (current.fetch.mock.calls.at(-1)![0] as Request).headers.has(
      "Authorization",
    ),
  ).toBe(false);
});

it.each([
  undefined,
  null,
  "",
  "Bearer private",
  "Basic a\r\nX: y",
  `Basic ${"a".repeat(8192)}`,
])(
  "rejects invalid replies and preserves the original cookie request (%j)",
  async (authorization) => {
    const current = worker(new Map([["tab-1", page(authorization)]]));
    await current.request("tab-1", "/api/clips/1/cover", {
      credentials: "same-origin",
    });
    const forwarded = current.fetch.mock.calls[0][0] as Request;
    expect(forwarded.headers.has("Authorization")).toBe(false);
    expect(forwarded.credentials).toBe("same-origin");
  },
);

it("does not request credentials from other origins, missing clients or closed pages", async () => {
  const foreign = {
    ...page(token),
    url: "https://other.test/",
    postMessage: vi.fn(),
  };
  const closed = {
    ...page(token),
    postMessage: () => {
      throw new Error("page closed");
    },
  };
  const current = worker(
    new Map<string, PageClient>([
      ["foreign", foreign],
      ["closed", closed],
    ]),
  );
  for (const id of ["", "missing", "foreign", "closed"])
    await current.request(id);
  expect(foreign.postMessage).not.toHaveBeenCalled();
  for (const [request] of current.fetch.mock.calls)
    expect((request as Request).headers.has("Authorization")).toBe(false);
});

it("bounds the wait when a page cannot respond", async () => {
  const current = worker(
    new Map([["tab-1", { ...page(token), postMessage: () => {} }]]),
  );
  await current.request();
  expect(current.fetch).toHaveBeenCalledOnce();
  expect(
    (current.fetch.mock.calls[0][0] as Request).headers.has("Authorization"),
  ).toBe(false);
});

it("ignores cross-origin, non-media and write requests", () => {
  const current = worker(new Map([["tab-1", page(token)]]));
  for (const [path, method] of [
    ["https://other.test/api/clips/1/video", "GET"],
    ["/api/dashboard", "GET"],
    ["/api/clips/1/video", "POST"],
  ])
    expect(current.request("tab-1", path, { method })).toBeUndefined();
  expect(current.get).not.toHaveBeenCalled();
  expect(current.fetch).not.toHaveBeenCalled();
});
